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
import { json, errorResponse } from '../../_middleware';
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
}

const EMBEDDING_MODEL = '@cf/baai/bge-base-en-v1.5';
const TOP_K = 100; // wider recall so diversified names (e.g. LLY) survive to client-side ranking

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

  // --- Thematic query: rate-limit the embed path, then catalog-first --------
  if (!query) return errorResponse('query or similarTo is required', 400);
  if (query.length > 200) return errorResponse('query too long', 400);

  const ip = request.headers.get('CF-Connecting-IP') || '';
  if (!(await checkRateLimit(env.RATE_LIMITER_SVC, ip))) {
    return errorResponse('rate limit exceeded', 429);
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
    const themeMatch = await env.VECTORIZE_THEMES.query(vector, { topK: 1 });
    const top = themeMatch.matches?.[0];
    if (top) {
      themeScore = top.score;
      themeSlug = slugify(top.id); // matched vector id IS the slug; normalize defensively
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
