/**
 * POST /api/admin/catalog   (header: Authorization: Bearer <REINDEX_SECRET>)
 * Body: { entries: [{ theme: string, items: [{ symbol, kind, why }] }, ...] }
 *
 * Bulk-loads curated theme catalog entries. For each entry it embeds the theme text
 * with Workers AI (same model as query time), upserts the vector into VECTORIZE_THEMES
 * (id = slug), and writes the catalog body to SEARCH_CACHE_KV (key `catalog:<slug>`).
 * Re-runnable (upsert + overwrite). Token-protected like /api/admin/reindex.
 *
 * This is the loader the Phase B curation workflow targets. It does NO LLM curation
 * itself — it just persists already-curated entries.
 */
import { json, errorResponse } from '../../_middleware';
import {
  slugify,
  putCatalogEntry,
  type CatalogItem,
  type CatalogEntry,
  type CatalogKind,
  type SearchCacheEnv,
} from '../../lib/search-cache';

interface Env extends SearchCacheEnv {
  AI: Ai;
  VECTORIZE_THEMES: VectorizeIndex;
  REINDEX_SECRET: string;
}

const EMBEDDING_MODEL = '@cf/baai/bge-base-en-v1.5';
const VALID_KINDS: CatalogKind[] = ['direct', 'picks-shovels'];

interface InputEntry {
  theme?: string;
  items?: { symbol?: string; kind?: string; why?: string }[];
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  const authHeader = request.headers.get('Authorization');
  if (!env.REINDEX_SECRET || authHeader !== `Bearer ${env.REINDEX_SECRET}`) {
    return errorResponse('unauthorized', 401);
  }

  let body: { entries?: InputEntry[] };
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  // Validate + normalize entries.
  const entries: { theme: string; slug: string; items: CatalogItem[] }[] = [];
  for (const raw of body.entries || []) {
    const theme = (raw.theme || '').trim();
    if (!theme) continue;
    const items: CatalogItem[] = (raw.items || [])
      .map((it) => ({
        symbol: (it.symbol || '').trim().toUpperCase(),
        kind: (VALID_KINDS.includes(it.kind as CatalogKind) ? it.kind : 'direct') as CatalogKind,
        why: (it.why || '').trim(),
      }))
      .filter((it) => it.symbol);
    if (!items.length) continue;
    entries.push({ theme, slug: slugify(theme), items });
  }

  if (!entries.length) return errorResponse('no valid entries provided', 400);

  // Embed all theme labels in one batch.
  const emb = (await env.AI.run(EMBEDDING_MODEL, {
    text: entries.map((e) => e.theme),
  })) as { data?: number[][] };
  const data = emb?.data;
  if (!data || data.length !== entries.length) {
    return errorResponse('embedding count mismatch', 502);
  }

  // Upsert theme vectors (id = slug) and write catalog bodies to KV.
  const curatedAt = new Date().toISOString();
  await env.VECTORIZE_THEMES.upsert(
    entries.map((e, i) => ({ id: e.slug, values: data[i], metadata: { theme: e.theme } }))
  );

  await Promise.all(
    entries.map((e) => {
      const entry: CatalogEntry = { theme: e.theme, slug: e.slug, items: e.items, curatedAt };
      return putCatalogEntry(env, entry);
    })
  );

  return json({ loaded: entries.length, slugs: entries.map((e) => e.slug) });
};
