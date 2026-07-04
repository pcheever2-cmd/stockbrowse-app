/**
 * POST /api/search/semantic
 * Body: { query: string, catalogOnly?: boolean }  OR  { similarTo: "AAPL" }
 * Returns: { source, query, similarTo, theme?, symbols: [{ symbol, score, why?, kind? }] }
 *
 * catalogOnly (probe mode): serve curated catalog picks on a hit; on a miss
 * return { source:'none', symbols: [] } — no raw-index fallback, no logMiss,
 * and the free-search quota is charged only on a hit.
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
// catalogOnly probes charge the search quota only on a HIT, so a separate
// per-day probe budget bounds the embedding + Vectorize cost of misses (the
// abuse rate-limiter is per-minute; this is the per-day backstop). Generous:
// a real user pauses on nowhere near 50 lookup-shaped words a day.
const FREE_PROBES_PER_DAY = 50;
const QUOTA_TTL_SECONDS = 172800; // 2 days — outlives the UTC day it meters

function quotaKey(kind: 'search' | 'probe', meterId: string): string {
  const day = new Date().toISOString().slice(0, 10);
  return `quota:${kind}:${day}:${meterId}`;
}

async function quotaUsed(env: Env, kind: 'search' | 'probe', meterId: string): Promise<number> {
  try {
    return parseInt((await env.SEARCH_CACHE_KV.get(quotaKey(kind, meterId))) || '0', 10) || 0;
  } catch {
    return 0; // KV unavailable → fail open, never block search on infra
  }
}

// Best-effort increment (non-atomic, same trade-off as logMiss — a racing
// double-count under-charges by at most one search).
async function chargeQuota(env: Env, kind: 'search' | 'probe', meterId: string, used: number): Promise<void> {
  try {
    await env.SEARCH_CACHE_KV.put(quotaKey(kind, meterId), String(used + 1), {
      expirationTtl: QUOTA_TTL_SECONDS,
    });
  } catch {
    /* KV unavailable → fail open */
  }
}

async function searchQuotaExceeded(env: Env, meterId: string): Promise<boolean> {
  const used = await quotaUsed(env, 'search', meterId);
  if (used >= FREE_SEARCHES_PER_DAY) return true;
  await chargeQuota(env, 'search', meterId, used);
  return false;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  let body: { query?: string; similarTo?: string; catalogOnly?: boolean };
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const similarTo = (body.similarTo || '').trim().toUpperCase();
  const query = (body.query || '').trim();
  // Catalog-only probe: the browse client sends this for ambiguous single
  // words that look like a ticker/name lookup ("oil" starts "Oil-Dri",
  // "gold" is Barrick's ticker). A hit serves curated picks like any
  // thematic search; a miss returns nothing instead of the raw-index
  // fallback and costs no search quota — a name lookup is not a smart
  // search. Honored only for probe-SHAPED queries (one short token): the
  // flag must not turn arbitrary long queries into uncharged catalog
  // searches.
  const catalogOnly =
    body.catalogOnly === true && !similarTo && query.length <= 40 && !/\s/.test(query);

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
  const quotaBlocked = async () => !unlimited && (await searchQuotaExceeded(env, meterId));
  const limitResponse = () =>
    json(
      {
        error: 'daily search limit reached',
        code: 'SEARCH_LIMIT',
        limit: FREE_SEARCHES_PER_DAY,
        message: `Free plan includes ${FREE_SEARCHES_PER_DAY} smart searches per day. Upgrade to Plus for unlimited search.`,
      },
      429
    );

  // --- "Stocks like X": per-stock neighbor lookup, no catalog ---------------
  if (similarTo) {
    const existing = await env.VECTORIZE.getByIds([similarTo]);
    const vector = existing?.[0]?.values as number[] | undefined;
    // 404 BEFORE the quota charge — an unknown symbol must not consume a search.
    if (!vector) return errorResponse(`no vector for ${similarTo}`, 404);
    if (await quotaBlocked()) return limitResponse();

    const result = await env.VECTORIZE.query(vector, { topK: TOP_K });
    const symbols = (result.matches || [])
      .map((m) => ({ symbol: m.id, score: m.score }))
      .filter((s) => s.symbol !== similarTo);
    return json({ source: 'semantic', query, similarTo, symbols });
  }

  // --- Thematic query: catalog-first --------------------------------------
  const noneResponse = () => json({ source: 'none', query, similarTo: null, symbols: [] });

  if (catalogOnly) {
    // Probes charge the search quota only on a catalog HIT (below). Both
    // exits here return an empty 200, NOT a 429 — the client silently keeps
    // its literal matches (the user typed a lookup-shaped word, not
    // knowingly a smart search). No free catalog hits once over the search
    // quota, and the probe budget bounds uncharged embed cost (charged
    // before the embed, hit or miss).
    if (!unlimited) {
      if ((await quotaUsed(env, 'search', meterId)) >= FREE_SEARCHES_PER_DAY) return noneResponse();
      const probes = await quotaUsed(env, 'probe', meterId);
      if (probes >= FREE_PROBES_PER_DAY) return noneResponse();
      await chargeQuota(env, 'probe', meterId, probes);
    }
  } else if (await quotaBlocked()) {
    // Quota charged before the embed on purpose: over-quota callers must not
    // keep incurring Workers AI cost, and charging failed embeds (rare 502s)
    // is the fail-closed side of that trade.
    return limitResponse();
  }

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
          // A probe that hits IS a smart search — charge it like one.
          if (catalogOnly && !unlimited) {
            await chargeQuota(env, 'search', meterId, await quotaUsed(env, 'search', meterId));
          }
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

  // Probe miss (or hit with a missing/empty KV entry): return nothing — the
  // client keeps its literal name/ticker matches. Near-misses are likely
  // genuine theme words ("shrooms" scored 0.797 before its alias) — keep
  // those in the curation funnel; name fragments like "murphy" score far
  // lower and stay out of the miss list. No themeScore in the response:
  // probes are cheap/uncharged, so they must not double as a free oracle
  // for the catalog threshold.
  if (catalogOnly) {
    if (typeof themeScore === 'number' && themeScore >= 0.7) await logMiss(env, query);
    return noneResponse();
  }

  // 2) Miss: record for later curation, then serve the raw stock-similarity index.
  await logMiss(env, query);
  const result = await env.VECTORIZE.query(vector, { topK: TOP_K });
  const symbols = (result.matches || []).map((m) => ({ symbol: m.id, score: m.score }));
  return json({ source: 'semantic', query, similarTo: null, themeScore, themeSlug, symbols });
};
