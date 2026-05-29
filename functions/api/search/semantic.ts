/**
 * POST /api/search/semantic
 * Body: { query: string }
 * Returns: { query, symbols: [{ symbol, score }] }
 *
 * Embeds the query with Workers AI (same model as the corpus) and returns the
 * nearest stocks from the Vectorize index, ranked by semantic similarity.
 * Public + cheap (embedding only). Cost controls (cache, rate limit) come in Phase 2.
 */
import { json, errorResponse } from '../../_middleware';

interface Env {
  AI: Ai;
  VECTORIZE: VectorizeIndex;
}

const EMBEDDING_MODEL = '@cf/baai/bge-base-en-v1.5';
const TOP_K = 50;

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  let body: { query?: string };
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const query = (body.query || '').trim();
  if (!query) return errorResponse('query is required', 400);
  if (query.length > 200) return errorResponse('query too long', 400);

  // Embed the query (must match the model used to build the index)
  const emb = (await env.AI.run(EMBEDDING_MODEL, { text: [query] })) as { data?: number[][] };
  const vector = emb?.data?.[0];
  if (!vector) return errorResponse('embedding failed', 502);

  // Nearest neighbors in the stock index
  const result = await env.VECTORIZE.query(vector, {
    topK: TOP_K,
    returnMetadata: 'all',
  });

  const symbols = (result.matches || []).map((m) => ({
    symbol: (m.metadata?.symbol as string) || m.id,
    score: m.score,
  }));

  return json({ query, symbols });
};
