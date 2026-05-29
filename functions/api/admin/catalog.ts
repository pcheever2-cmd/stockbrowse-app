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
  aliases?: string[];
}

const MAX_ALIASES = 8;
const EMBED_CHUNK = 100; // Workers AI text-array cap per call

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
  const entries: { theme: string; slug: string; items: CatalogItem[]; aliases: string[] }[] = [];
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
    const themeLower = theme.toLowerCase();
    const aliases = Array.from(
      new Set((raw.aliases || []).map((a) => (a || '').trim()).filter(Boolean))
    )
      .filter((a) => a.toLowerCase() !== themeLower) // don't duplicate the label
      .slice(0, MAX_ALIASES);
    entries.push({ theme, slug: slugify(theme), items, aliases });
  }

  if (!entries.length) return errorResponse('no valid entries provided', 400);

  // Build the flat list of texts to embed: theme label + each alias, all mapping to the
  // entry's slug. Alias vectors get id `slug::N`; the serve path reads metadata.slug to
  // resolve any of them back to the one KV catalog entry.
  const texts: string[] = [];
  const vmeta: { id: string; slug: string; theme: string }[] = [];
  for (const e of entries) {
    texts.push(e.theme);
    vmeta.push({ id: e.slug, slug: e.slug, theme: e.theme });
    e.aliases.forEach((a, i) => {
      texts.push(a);
      vmeta.push({ id: `${e.slug}::${i + 1}`, slug: e.slug, theme: e.theme });
    });
  }

  // Embed in sub-batches (Workers AI caps the text array per call).
  const vectors: { id: string; values: number[]; metadata: { slug: string; theme: string } }[] = [];
  for (let i = 0; i < texts.length; i += EMBED_CHUNK) {
    const chunk = texts.slice(i, i + EMBED_CHUNK);
    const emb = (await env.AI.run(EMBEDDING_MODEL, { text: chunk })) as { data?: number[][] };
    if (!emb?.data || emb.data.length !== chunk.length) {
      return errorResponse('embedding count mismatch', 502);
    }
    emb.data.forEach((values, j) => {
      const m = vmeta[i + j];
      vectors.push({ id: m.id, values, metadata: { slug: m.slug, theme: m.theme } });
    });
  }

  await env.VECTORIZE_THEMES.upsert(vectors);

  // One KV catalog entry per slug (carries items + aliases).
  const curatedAt = new Date().toISOString();
  await Promise.all(
    entries.map((e) =>
      putCatalogEntry(env, { theme: e.theme, slug: e.slug, items: e.items, aliases: e.aliases, curatedAt })
    )
  );

  return json({
    loaded: entries.length,
    vectors: vectors.length,
    slugs: entries.map((e) => e.slug),
  });
};
