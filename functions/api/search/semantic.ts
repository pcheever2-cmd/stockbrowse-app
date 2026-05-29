/**
 * POST /api/search/semantic
 * Body: { query: string }  OR  { similarTo: "AAPL" }
 * Returns: { symbols: [{ symbol, score }] }
 *
 * Thematic search ({query}): embeds the text with Workers AI (same model as the
 * corpus) and returns the nearest stocks. "Similar to" ({similarTo}): looks up
 * that symbol's stored vector and returns ITS neighbors (true similarity, not a
 * phrase match). Ranked by semantic similarity; quality-weighting happens client-side.
 * Public + cheap. Cost controls (cache, rate limit) come in Phase 2.
 */
import { json, errorResponse } from '../../_middleware';

interface Env {
  AI: Ai;
  VECTORIZE: VectorizeIndex;
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

  let vector: number[] | undefined;

  if (similarTo) {
    // "Stocks like X": use X's own embedding, not a phrase match.
    const existing = await env.VECTORIZE.getByIds([similarTo]);
    vector = existing?.[0]?.values as number[] | undefined;
    if (!vector) return errorResponse(`no vector for ${similarTo}`, 404);
  } else {
    if (!query) return errorResponse('query or similarTo is required', 400);
    if (query.length > 200) return errorResponse('query too long', 400);
    const emb = (await env.AI.run(EMBEDDING_MODEL, { text: [query] })) as { data?: number[][] };
    vector = emb?.data?.[0];
    if (!vector) return errorResponse('embedding failed', 502);
  }

  const result = await env.VECTORIZE.query(vector, {
    topK: TOP_K,
    returnMetadata: 'all',
  });

  const symbols = (result.matches || [])
    .map((m) => ({ symbol: (m.metadata?.symbol as string) || m.id, score: m.score }))
    .filter((s) => s.symbol !== similarTo); // exclude the reference stock itself

  return json({ query, similarTo, symbols });
};
