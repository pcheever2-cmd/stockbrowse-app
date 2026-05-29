/**
 * POST /api/admin/reindex   (header: Authorization: Bearer <REINDEX_SECRET>)
 * Body: { stocks: [{ symbol: string, text: string }, ...] }   (batch, ~50-100 per call)
 *
 * Embeds each stock's text with Workers AI (same model as query time) and upserts
 * the vectors into Vectorize, keyed by symbol. Re-runnable; called by the local
 * indexing script. Token-protected so it can't be triggered publicly.
 */
import { json, errorResponse } from '../../_middleware';

interface Env {
  AI: Ai;
  VECTORIZE: VectorizeIndex;
  REINDEX_SECRET: string;
}

const EMBEDDING_MODEL = '@cf/baai/bge-base-en-v1.5';

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  const authHeader = request.headers.get('Authorization');
  if (!env.REINDEX_SECRET || authHeader !== `Bearer ${env.REINDEX_SECRET}`) {
    return errorResponse('unauthorized', 401);
  }

  let body: { stocks?: { symbol: string; text: string }[] };
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const stocks = (body.stocks || []).filter((s) => s?.symbol && s?.text);
  if (!stocks.length) return errorResponse('no stocks provided', 400);

  // Embed the whole batch in one call
  const emb = (await env.AI.run(EMBEDDING_MODEL, {
    text: stocks.map((s) => s.text),
  })) as { data?: number[][] };
  const data = emb?.data;
  if (!data || data.length !== stocks.length) {
    return errorResponse('embedding count mismatch', 502);
  }

  const vectors = data.map((values: number[], i: number) => ({
    id: stocks[i].symbol,
    values,
    metadata: { symbol: stocks[i].symbol },
  }));

  await env.VECTORIZE.upsert(vectors);
  return json({ upserted: vectors.length });
};
