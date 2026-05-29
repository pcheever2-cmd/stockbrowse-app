/**
 * Shared helpers for the Curated Theme Catalog (Phase A plumbing).
 *
 * The catalog body lives in SEARCH_CACHE_KV (keyed `catalog:<slug>`); the theme
 * embedding lives in the VECTORIZE_THEMES index (vector id = slug). Prices and
 * Compass Scores are NOT stored here — they join to live data client-side at serve
 * time, so a daily data refresh costs zero curation tokens and delisted names drop
 * out automatically.
 *
 * Also holds the cost guardrails: a per-IP rate limiter (active now, protects the
 * embed path) and a monthly budget counter (dormant — scaffolding any future paid
 * path, e.g. Phase C curate-on-miss, must check before spending).
 */

export interface SearchCacheEnv {
  SEARCH_CACHE_KV: KVNamespace;
}

export type CatalogKind = 'direct' | 'picks-shovels';

export interface CatalogItem {
  symbol: string;
  kind: CatalogKind;
  /**
   * The one-line "why this name fits the theme" shown on the card. Trust-critical
   * microcopy — Phase B curation must follow this spec (it's also the card voice rule):
   *   - ≤10 words, no trailing period; it's a label, not a sentence.
   *   - Name the SPECIFIC mechanism/product/customer, e.g.
   *     "makes the auto-injector pens for Wegovy", "designs the GPUs that train models".
   *   - Lead with the verb/role: makes / supplies / owns the patent on / runs.
   *   - DON'T restate the theme ("a GLP-1 stock" under a GLP-1 theme) — explain HOW.
   *   - DON'T use hype/filler: leading, robust, key player, pioneer, innovative,
   *     well-positioned, poised, "exposure to", "plays in the X space". The Compass
   *     Score is the quality signal; the why is just the mechanism.
   *   - No "not just X but Y". Specific over vague. Say it like you'd say it aloud.
   */
  why: string;
}

export interface CatalogEntry {
  theme: string; // canonical human-readable theme label
  slug: string; // slugify(theme) — Vectorize id + KV key suffix
  items: CatalogItem[];
  curatedAt: string; // ISO timestamp
}

// Tunables ------------------------------------------------------------------
// Cosine cutoff for serving a curated theme. Calibrated on the 15-theme pilot:
// correct paraphrase matches scored ≥0.640, wrong/negative matches ≤0.559 — 0.60 sits
// in the gap (all true matches hit, zero false positives). Re-calibrate for the full
// rollout: more themes = denser space = wrong-match scores may creep up. Brand-name
// queries ("ozempic") embed poorly and need alias vectors, not a lower threshold.
export const HIT_THRESHOLD = 0.6;
export const MONTHLY_BUDGET_CAP = 5_000; // arbitrary "spend units" ceiling for any paid path (dormant in Phase A)
const RECENT_MISS_MAX = 200; // cap on the rolling recent-miss list

// Keys ----------------------------------------------------------------------
const catalogKey = (slug: string) => `catalog:${slug}`;
const missKey = (q: string) => `miss:${q}`;
const RECENT_MISS_KEY = 'miss:_recent';
const budgetKey = (month: string) => `budget:${month}`;

/** kebab-case slug; stable for use as a Vectorize id and KV key suffix. */
export function slugify(theme: string): string {
  return theme
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Normalize a raw query for miss aggregation (lowercase, collapse whitespace). */
export function normalizeQuery(query: string): string {
  return query.toLowerCase().trim().replace(/\s+/g, ' ');
}

// Catalog -------------------------------------------------------------------
export async function getCatalogEntry(
  env: SearchCacheEnv,
  slug: string
): Promise<CatalogEntry | null> {
  const raw = await env.SEARCH_CACHE_KV.get(catalogKey(slug));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CatalogEntry;
  } catch {
    return null;
  }
}

export async function putCatalogEntry(env: SearchCacheEnv, entry: CatalogEntry): Promise<void> {
  await env.SEARCH_CACHE_KV.put(catalogKey(entry.slug), JSON.stringify(entry));
}

// Miss logging --------------------------------------------------------------
/**
 * Record a query that found no cataloged theme, so Phase D can batch-curate the
 * top misses. Best-effort: counter increments are non-atomic (fine at current
 * traffic) and all errors are swallowed so logging never breaks the search path.
 */
export async function logMiss(env: SearchCacheEnv, query: string): Promise<void> {
  const q = normalizeQuery(query);
  if (!q) return;
  try {
    const current = parseInt((await env.SEARCH_CACHE_KV.get(missKey(q))) || '0', 10) || 0;
    await env.SEARCH_CACHE_KV.put(missKey(q), String(current + 1));

    // Maintain a small rolling list of distinct recent misses for quick review.
    const recentRaw = await env.SEARCH_CACHE_KV.get(RECENT_MISS_KEY);
    let recent: string[] = [];
    if (recentRaw) {
      try {
        recent = JSON.parse(recentRaw) as string[];
      } catch {
        recent = [];
      }
    }
    recent = [q, ...recent.filter((x) => x !== q)].slice(0, RECENT_MISS_MAX);
    await env.SEARCH_CACHE_KV.put(RECENT_MISS_KEY, JSON.stringify(recent));
  } catch {
    // never let logging break search
  }
}

// Rate limiting -------------------------------------------------------------
/**
 * Per-IP limiter on the embed path. Pages can't host the native rate-limit binding,
 * so this calls the standalone stockbrowse-rate-limiter Worker over a service binding
 * (a Fetcher) — strongly consistent within a CF location, unlike KV. The Worker
 * returns 200 (within cap) or 429 (exceeded). Fails OPEN on errors / missing binding —
 * availability over strictness for a free endpoint. No-op when ip is empty.
 */
export async function checkRateLimit(svc: Fetcher | undefined, ip: string): Promise<boolean> {
  if (!ip || !svc) return true;
  try {
    const res = await svc.fetch(`https://rate-limiter/?key=${encodeURIComponent(ip)}`);
    return res.ok; // 200 within cap, 429 exceeded
  } catch {
    return true;
  }
}

// Budget (dormant in Phase A) ----------------------------------------------
function currentMonth(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** True if the current month's recorded spend is below the cap. */
export async function withinBudget(env: SearchCacheEnv): Promise<boolean> {
  try {
    const spent = parseInt((await env.SEARCH_CACHE_KV.get(budgetKey(currentMonth()))) || '0', 10) || 0;
    return spent < MONTHLY_BUDGET_CAP;
  } catch {
    return false; // fail CLOSED on the paid path — never overspend on a KV blip
  }
}

/** Add to the current month's spend counter. Call after any paid operation. */
export async function recordSpend(env: SearchCacheEnv, units: number): Promise<void> {
  if (units <= 0) return;
  const key = budgetKey(currentMonth());
  try {
    const spent = parseInt((await env.SEARCH_CACHE_KV.get(key)) || '0', 10) || 0;
    await env.SEARCH_CACHE_KV.put(key, String(spent + units));
  } catch {
    // best-effort
  }
}
