/**
 * POST /api/search/semantic
 * Body: { query: string }  OR  { similarTo: "AAPL" }
 * Returns: { source, query, similarTo, theme?, symbols: [{ symbol, score, why?, kind? }] }
 *
 * Thematic search ({query}): embeds the text once with Workers AI, then:
 *   1. checks the curated theme catalog (VECTORIZE_THEMES, topK=1). If the nearest
 *      cataloged theme is within HIT_THRESHOLD → HIT: serve the curated picks with a
 *      one-line "why" each (source:'catalog').
 *   2. otherwise → MISS: log the query for later curation and fall back to the raw
 *      stock-similarity index, exactly as before (source:'semantic').
 *
 * "Similar to" ({similarTo}): looks up that symbol's stored vector and returns ITS
 * neighbors (true similarity). No catalog — it's a per-stock lookup, not a theme.
 *
 * Prices & Compass Scores are applied LIVE client-side (the client joins these
 * symbols to its loaded data), so this endpoint never touches stale data and
 * delisted names drop out automatically.
 */
import { json, errorResponse, requireAuth } from '../../_middleware';
import {
  getCatalogEntry,
  logMiss,
  checkRateLimit,
  slugify,
  HIT_THRESHOLD,
  type SearchCacheEnv,
} from '../../lib/search-cache';

interface Env extends SearchCacheEnv {
  AI: Ai;
  VECTORIZE: VectorizeIndex;
  VECTORIZE_THEMES: VectorizeIndex;
  RATE_LIMITER_SVC: Fetcher;
  // requireAuth deps (present in the Pages env; typed here for the optional
  // paid-tier exemption below)
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  STOCKS_PREMIUM_KV: KVNamespace;
}

const EMBEDDING_MODEL = '@cf/baai/bge-base-en-v1.5';
const TOP_K = 100; // wider recall so diversified names (e.g. LLY) survive to client-side ranking

// Free-tier smart-search quota (server-enforced — the searches copy on
// home/pricing must stay true). Anonymous callers are metered by IP; logged-in
// free users by userId; any paid tier is exempt. Keys live in SEARCH_CACHE_KV
// (`quota:` prefix — no collision with catalog:/miss:) and self-expire.
const FREE_SEARCHES_PER_DAY = 5;
const QUOTA_TTL_SECONDS = 172800; // 2 days — outlives the UTC day it meters

async function searchQuotaExceeded(env: Env, meterId: string): Promise<boolean> {
  const day = new Date().toISOString().slice(0, 10);
  const key = `quota:search:${day}:${meterId}`;
  try {
    const used = parseInt((await env.SEARCH_CACHE_KV.get(key)) || '0', 10) || 0;
    if (used >= FREE_SEARCHES_PER_DAY) return true;
    // Best-effort increment (non-atomic, same trade-off as logMiss — a racing
    // double-count under-charges by at most one search).
    await env.SEARCH_CACHE_KV.put(key, String(used + 1), { expirationTtl: QUOTA_TTL_SECONDS });
    return false;
  } catch {
    return false; // KV unavailable → fail open, never block search on infra
  }
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  let body: { query?: string; similarTo?: string };
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const similarTo = (body.similarTo || '').trim().toUpperCase();
  const query = (body.query || '').trim();

  if (!similarTo && !query) return errorResponse('query or similarTo is required', 400);
  if (query.length > 200) return errorResponse('query too long', 400);

  // Abuse rate-limit covers BOTH branches (similarTo previously bypassed it —
  // unmetered anonymous Vectorize queries).
  const ip = request.headers.get('CF-Connecting-IP') || '';
  if (!(await checkRateLimit(env.RATE_LIMITER_SVC, ip))) {
    return errorResponse('rate limit exceeded', 429);
  }

  // Daily smart-search quota covers BOTH branches too — "stocks like X" is a
  // smart search in the UI, so it must count against the same 5/day.
  // UNLIMITED requires Plus or Pro (the pricing page sells it as a Plus
  // feature; Newsletter is "everything in Free"). A Bearer header is OPTIONAL —
  // an invalid/expired token degrades to anonymous metering, never a 401
  // (search must keep working through a token refresh).
  let meterId = `ip:${ip || 'unknown'}`;
  let unlimited = false;
  if (request.headers.get('Authorization')?.startsWith('Bearer ')) {
    const identity = await requireAuth(env, request);
    if (!(identity instanceof Response)) {
      meterId = `user:${identity.userId}`;
      unlimited = identity.tier === 'plus' || identity.tier === 'pro';
    }
  }
  if (!unlimited && (await searchQuotaExceeded(env, meterId))) {
    return json(
      {
        error: 'daily search limit reached',
        code: 'SEARCH_LIMIT',
        limit: FREE_SEARCHES_PER_DAY,
        message: `Free plan includes ${FREE_SEARCHES_PER_DAY} smart searches per day. Upgrade to Plus for unlimited search.`,
      },
      429
    );
  }

  // --- "Stocks like X": per-stock neighbor lookup, no catalog ---------------
  if (similarTo) {
    const existing = await env.VECTORIZE.getByIds([similarTo]);
    const vector = existing?.[0]?.values as number[] | undefined;
    if (!vector) return errorResponse(`no vector for ${similarTo}`, 404);

    const result = await env.VECTORIZE.query(vector, { topK: TOP_K });
    const symbols = (result.matches || [])
      .map((m) => ({ symbol: m.id, score: m.score }))
      .filter((s) => s.symbol !== similarTo);
    return json({ source: 'semantic', query, similarTo, symbols });
  }

  // --- Thematic query: catalog-first --------------------------------------

  // Embed once; the same vector serves both the themes index and the stocks index.
  const emb = (await env.AI.run(EMBEDDING_MODEL, { text: [query] })) as { data?: number[][] };
  const vector = emb?.data?.[0];
  if (!vector) return errorResponse('embedding failed', 502);

  // 1) Catalog hit? Nearest cataloged theme within threshold.
  // themeScore/themeSlug are surfaced on BOTH hit and miss for threshold calibration.
  let themeScore: number | undefined;
  let themeSlug: string | undefined;
  try {
    const themeMatch = await env.VECTORIZE_THEMES.query(vector, { topK: 1, returnMetadata: 'all' });
    const top = themeMatch.matches?.[0];
    if (top) {
      themeScore = top.score;
      // Alias vectors share their theme's slug via metadata; fall back to the id (stripping
      // any `::N` alias suffix) for older label-only vectors. returnMetadata is safe at topK=1.
      themeSlug =
        (top.metadata?.slug as string | undefined) || slugify(String(top.id).split('::')[0]);
      if (top.score >= HIT_THRESHOLD) {
        const entry = await getCatalogEntry(env, themeSlug);
        if (entry && entry.items.length) {
          // Preserve curated order via a descending synthetic score so the client's
          // existing "relevance" sort works; it then re-weights by Compass Score.
          const n = entry.items.length;
          const symbols = entry.items.map((item, i) => ({
            symbol: item.symbol,
            score: (n - i) / n,
            why: item.why,
            kind: item.kind,
          }));
          return json({ source: 'catalog', query, similarTo: null, theme: entry.theme, themeScore, themeSlug, symbols });
        }
        // Index hit but KV entry missing/empty → fall through to raw semantic.
      }
    }
  } catch {
    // Themes index unavailable (e.g. empty) → fall through to raw semantic.
  }

  // 2) Miss: record for later curation, then serve the raw stock-similarity index.
  await logMiss(env, query);
  const result = await env.VECTORIZE.query(vector, { topK: TOP_K });
  const symbols = (result.matches || []).map((m) => ({ symbol: m.id, score: m.score }));
  return json({ source: 'semantic', query, similarTo: null, themeScore, themeSlug, symbols });
};
