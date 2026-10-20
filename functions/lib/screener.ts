/**
 * Shared logic for the private assistant API: loads the `screener:index` KV
 * value (built daily by the pipeline's export_screener_kv.py), applies the
 * owner's hard filter and screens, ranks by philosophy profile, and builds
 * human-readable `why` / `flags` strings so a consuming AI can reason with
 * the same rules the owner invests by.
 *
 * Design principle (firm): this API returns data, scores, and rule-based
 * flags only — never a "recommendation" field. Final synthesis belongs to
 * the consuming AI.
 */
import { errorResponse } from '../_middleware';

export interface ScreenerRow {
  symbol: string;
  name: string | null;
  price: number | null;
  priceAsOf: string | null;
  compass: number | null;
  grade: string | null;
  sector: string | null;
  industry: string | null;
  mcapB: number | null;
  analysts: number | null;
  consensus: string | null;
  golden: boolean;
  catalyst: number | null;
  catalystTag: boolean;
  beatStreak: number | null;
  epsSurprisePct: number | null;
  netUpgrades180d: number | null;
  fvUpsidePct: number | null;
  fvVerdict: string | null;
  evEbitda: number | null;
  fwdPe: number | null;
  peg: number | null;
  rsi: number | null;
  trendSignal: string | null;
  priceVsSma200Pct: number | null;
  peNow: number | null;
  pe5yMedian: number | null;
  pePctile: number | null;
  peVsMedPct: number | null;
  peN: number | null;
  evNow: number | null;
  ev5yMedian: number | null;
  evPctile: number | null;
  evVsMedPct: number | null;
  evN: number | null;
}

export interface ScreenerIndex {
  asOf: string;
  count: number;
  stocks: ScreenerRow[];
}

// ---------- Philosophy profiles ----------
// Each profile is pure data: rank weights + default screen thresholds.
// Adding a variant (deeper value, income tilt, high-risk sleeve) is one entry
// here — no endpoint or prompt changes.
export interface Profile {
  compassWeight: number;
  catalystWeight: number;
  valuationPenalty: number; // multiplies mean(non-null pePctile, evPctile)
  defaults: {
    minCompass: number;
    minCatalyst: number;
    maxPePctile: number;
    maxEvPctile: number;
  };
  formula: string; // echoed verbatim in responses so the AI never guesses
}

export const PROFILES: Record<string, Profile> = {
  quality_catalyst: {
    compassWeight: 1.0,
    catalystWeight: 1.0,
    valuationPenalty: 0.3,
    defaults: { minCompass: 80, minCatalyst: 60, maxPePctile: 70, maxEvPctile: 70 },
    formula:
      'rankScore = 1.0*compass + 1.0*catalyst - 0.3*mean(non-null of pePctile, evPctile); ' +
      'pePctile/evPctile rank today’s trailing multiple within the stock’s own 5-yr daily distribution (high = expensive vs own history)',
  },
};

export const DEFAULT_PROFILE = 'quality_catalyst';

export interface ScreenParams {
  grades?: string[];
  sectors?: string[];
  excludeSectors?: string[];
  industries?: string[];
  minCompass?: number;
  minCatalyst?: number;
  maxPePctile?: number;
  maxEvPctile?: number;
  minPrice?: number;
  maxPrice?: number;
  minMcapB?: number;
  maxMcapB?: number;
  minAnalysts?: number;
  golden?: boolean;
  catalystTag?: boolean;
  includeNoHistory?: boolean;
}

export async function loadIndex(kv: KVNamespace): Promise<ScreenerIndex | Response> {
  const index = await kv.get<ScreenerIndex>('screener:index', 'json');
  if (!index || !Array.isArray(index.stocks)) {
    return errorResponse('screener index not available (pipeline has not published it yet)', 503);
  }
  return index;
}

/** The owner's one non-negotiable: real analyst coverage. Null fails. */
export function hardFilter(row: ScreenerRow): boolean {
  return (row.analysts ?? 0) >= 2;
}

function valuationGate(row: ScreenerRow, maxPe?: number, maxEv?: number, includeNoHistory?: boolean): boolean {
  const checks: boolean[] = [];
  if (row.pePctile !== null && maxPe !== undefined) checks.push(row.pePctile <= maxPe);
  if (row.evPctile !== null && maxEv !== undefined) checks.push(row.evPctile <= maxEv);
  if (row.pePctile === null && row.evPctile === null) {
    // No 5-yr history at all (banks without EBITDA, recent IPOs, negative earnings).
    return includeNoHistory === true || (maxPe === undefined && maxEv === undefined);
  }
  return checks.every(Boolean);
}

export function applyScreen(rows: ScreenerRow[], p: ScreenParams): ScreenerRow[] {
  const sectors = p.sectors?.map(s => s.toLowerCase());
  const exclude = p.excludeSectors?.map(s => s.toLowerCase());
  const industries = p.industries?.map(s => s.toLowerCase());
  const grades = p.grades?.map(g => g.toUpperCase());
  return rows.filter(row => {
    if (!hardFilter(row)) return false;
    if (p.minAnalysts !== undefined && (row.analysts ?? 0) < p.minAnalysts) return false;
    if (grades?.length && !grades.includes(row.grade ?? '')) return false;
    if (sectors?.length && !sectors.includes((row.sector ?? '').toLowerCase())) return false;
    if (exclude?.length && exclude.includes((row.sector ?? '').toLowerCase())) return false;
    if (industries?.length && !industries.includes((row.industry ?? '').toLowerCase())) return false;
    if (p.minCompass !== undefined && (row.compass ?? -1) < p.minCompass) return false;
    if (p.minCatalyst !== undefined && (row.catalyst ?? -1) < p.minCatalyst) return false;
    if (p.minPrice !== undefined && (row.price ?? -1) < p.minPrice) return false;
    if (p.maxPrice !== undefined && (row.price ?? Infinity) > p.maxPrice) return false;
    if (p.minMcapB !== undefined && (row.mcapB ?? -1) < p.minMcapB) return false;
    if (p.maxMcapB !== undefined && (row.mcapB ?? Infinity) > p.maxMcapB) return false;
    if (p.golden && !row.golden) return false;
    if (p.catalystTag && !row.catalystTag) return false;
    if (!valuationGate(row, p.maxPePctile, p.maxEvPctile, p.includeNoHistory)) return false;
    return true;
  });
}

function meanValuationPctile(row: ScreenerRow): number | null {
  const vals = [row.pePctile, row.evPctile].filter((v): v is number => v !== null);
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

export function rankScore(row: ScreenerRow, profile: Profile): number {
  const pct = meanValuationPctile(row);
  return (
    profile.compassWeight * (row.compass ?? 0) +
    profile.catalystWeight * (row.catalyst ?? 0) -
    profile.valuationPenalty * (pct ?? 0)
  );
}

export type SortKey = 'rank' | 'compass' | 'catalyst' | 'valuation' | 'fvUpside';

export function sortRows(rows: ScreenerRow[], sort: SortKey, profile: Profile): ScreenerRow[] {
  const sorted = [...rows];
  switch (sort) {
    case 'compass':
      sorted.sort((a, b) => (b.compass ?? 0) - (a.compass ?? 0));
      break;
    case 'catalyst':
      sorted.sort((a, b) => (b.catalyst ?? 0) - (a.catalyst ?? 0));
      break;
    case 'valuation': // cheapest vs own history first
      sorted.sort((a, b) => (meanValuationPctile(a) ?? 101) - (meanValuationPctile(b) ?? 101));
      break;
    case 'fvUpside':
      sorted.sort((a, b) => (b.fvUpsidePct ?? -Infinity) - (a.fvUpsidePct ?? -Infinity));
      break;
    default:
      sorted.sort((a, b) => rankScore(b, profile) - rankScore(a, profile));
  }
  return sorted;
}

const fmt = (v: number | null | undefined, nd = 1): string =>
  v === null || v === undefined ? '?' : v.toFixed(nd);

/** Human-readable factor lines so the consuming AI can reason, not guess. */
export function buildWhy(row: ScreenerRow): string[] {
  const why: string[] = [];
  if (row.compass !== null) why.push(`Compass ${row.compass} (${row.grade ?? '?'})`);
  if (row.catalyst !== null) {
    const parts: string[] = [];
    if (row.beatStreak) parts.push(`beat streak ${row.beatStreak}`);
    if (row.epsSurprisePct !== null) parts.push(`last EPS surprise ${row.epsSurprisePct > 0 ? '+' : ''}${fmt(row.epsSurprisePct)}%`);
    if (row.netUpgrades180d !== null) parts.push(`net upgrades ${row.netUpgrades180d > 0 ? '+' : ''}${row.netUpgrades180d} (180d)`);
    why.push(`Catalyst ${row.catalyst}${parts.length ? ' — ' + parts.join(', ') : ''}`);
  }
  if (row.evPctile !== null) {
    const dir = (row.evVsMedPct ?? 0) >= 0 ? 'above' : 'below';
    why.push(`EV/EBITDA ${fmt(row.evNow)} is ${fmt(Math.abs(row.evVsMedPct ?? 0))}% ${dir} 5-yr median ${fmt(row.ev5yMedian)} (${row.evPctile}th percentile)`);
  }
  if (row.pePctile !== null) {
    const dir = (row.peVsMedPct ?? 0) >= 0 ? 'above' : 'below';
    why.push(`P/E ${fmt(row.peNow)} is ${fmt(Math.abs(row.peVsMedPct ?? 0))}% ${dir} 5-yr median ${fmt(row.pe5yMedian)} (${row.pePctile}th percentile)`);
  }
  if (row.pePctile === null && row.evPctile === null) {
    why.push('No 5-yr valuation history (short/absent multiple series)');
  } else if (row.pePctile === null) {
    why.push('P/E history unavailable — valuation gated on EV/EBITDA only');
  } else if (row.evPctile === null) {
    why.push('EV/EBITDA history unavailable — valuation gated on P/E only');
  }
  if (row.fvUpsidePct !== null) {
    why.push(`Fair value ${row.fvUpsidePct > 0 ? '+' : ''}${fmt(row.fvUpsidePct)}% upside (${row.fvVerdict ?? 'n/a'})`);
  }
  if (row.golden) why.push('Golden stock (top-decile Compass × top-decile catalyst)');
  if (row.analysts !== null) why.push(`${row.analysts} analysts, consensus ${row.consensus ?? 'n/a'}`);
  const momentum: string[] = [];
  if (row.rsi !== null) momentum.push(`RSI ${fmt(row.rsi)}`);
  if (row.trendSignal) momentum.push(row.trendSignal);
  if (row.priceVsSma200Pct !== null) momentum.push(`price ${row.priceVsSma200Pct > 0 ? '+' : ''}${fmt(row.priceVsSma200Pct)}% vs SMA200`);
  if (momentum.length) why.push(`Momentum context: ${momentum.join(', ')}`);
  return why;
}

/** Rule-based cautions for held positions. Pointers, never verdicts. */
export function buildFlags(row: ScreenerRow): string[] {
  const flags: string[] = [];
  if ((row.pePctile ?? 0) >= 85 || (row.evPctile ?? 0) >= 85) {
    flags.push('expensive vs own 5-yr history (valuation percentile ≥ 85)');
  }
  if ((row.netUpgrades180d ?? 0) < 0) flags.push('net analyst downgrades over 180d');
  if (row.fvVerdict === 'Overvalued') flags.push('fair-value model says Overvalued');
  if ((row.analysts ?? 0) < 2) flags.push('analyst coverage below 2 (coverage lost)');
  return flags;
}

/**
 * Parse shared query params for /ideas and /screen.
 *
 * Strictness contract (a consuming AI must never reason from results it
 * didn't ask for): a numeric param that is present but unparseable is an
 * ERROR, and so is any param name we don't recognize — both produce a 400
 * instead of silently ignored input. Common synonyms are accepted as aliases.
 */
const PARAM_ALIASES: Record<string, string> = {
  sector: 'sectors',
  excludeSector: 'excludeSectors',
  industry: 'industries',
  grade: 'grades',
  limit: 'maxN',
};

const SCREEN_PARAM_NAMES = new Set([
  'grades', 'sectors', 'excludeSectors', 'industries',
  'minCompass', 'minCatalyst', 'maxPePctile', 'maxEvPctile',
  'minPrice', 'maxPrice', 'minMcapB', 'maxMcapB', 'minAnalysts',
  'golden', 'catalystTag', 'includeNoHistory',
]);

export function parseScreenParams(
  url: URL,
  extraAllowed: string[],
): { params: ScreenParams; errors: string[] } {
  const errors: string[] = [];
  const allowed = new Set([...SCREEN_PARAM_NAMES, ...extraAllowed]);

  // Canonicalize aliases, reject unknown names outright.
  const values = new Map<string, string>();
  for (const [rawKey, v] of url.searchParams.entries()) {
    const key = PARAM_ALIASES[rawKey] ?? rawKey;
    if (!allowed.has(key)) {
      errors.push(`unknown param '${rawKey}'`);
      continue;
    }
    values.set(key, v);
  }
  if (errors.length) {
    errors.push(`valid params: ${[...allowed].sort().join(', ')} (aliases: ${Object.keys(PARAM_ALIASES).join(', ')})`);
  }

  const num = (k: string): number | undefined => {
    const v = values.get(k);
    if (v === undefined || v === '') return undefined;
    const n = Number(v);
    if (!Number.isFinite(n)) {
      errors.push(`${k}='${v}' is not a number`);
      return undefined;
    }
    return n;
  };
  const list = (k: string): string[] | undefined => {
    const v = values.get(k);
    return v ? v.split(',').map(s => s.trim()).filter(Boolean) : undefined;
  };
  const flag = (k: string): boolean => values.get(k) === '1';
  const params: ScreenParams = {
    grades: list('grades'),
    sectors: list('sectors'),
    excludeSectors: list('excludeSectors'),
    industries: list('industries'),
    minCompass: num('minCompass'),
    minCatalyst: num('minCatalyst'),
    maxPePctile: num('maxPePctile'),
    maxEvPctile: num('maxEvPctile'),
    minPrice: num('minPrice'),
    maxPrice: num('maxPrice'),
    minMcapB: num('minMcapB'),
    maxMcapB: num('maxMcapB'),
    minAnalysts: num('minAnalysts'),
    golden: flag('golden'),
    catalystTag: flag('catalystTag'),
    includeNoHistory: flag('includeNoHistory'),
  };
  return { params, errors };
}

/** Shared paging/sort parsing for /ideas and /screen (maxN accepts alias 'limit'). */
export function parsePaging(
  url: URL,
  defaults: { maxN: number; cap: number; sort: SortKey },
): { maxN: number; offset: number; sort: SortKey; error: string | null } {
  const rawMaxN = url.searchParams.get('maxN') ?? url.searchParams.get('limit');
  if (rawMaxN && !Number.isFinite(Number(rawMaxN))) {
    return { maxN: 0, offset: 0, sort: defaults.sort, error: `maxN='${rawMaxN}' is not a number` };
  }
  const rawOffset = url.searchParams.get('offset');
  if (rawOffset && (!Number.isFinite(Number(rawOffset)) || Number(rawOffset) < 0)) {
    return { maxN: 0, offset: 0, sort: defaults.sort, error: `offset='${rawOffset}' must be a non-negative number` };
  }
  let sort = (url.searchParams.get('sort') || defaults.sort) as SortKey;
  if ((sort as string) === 'rankScore') sort = 'rank'; // common synonym
  if (!['rank', 'compass', 'catalyst', 'valuation', 'fvUpside'].includes(sort)) {
    return { maxN: 0, offset: 0, sort: defaults.sort, error: `unknown sort '${sort}' — valid: rank, compass, catalyst, valuation, fvUpside (rankScore = rank)` };
  }
  return {
    maxN: Math.max(1, Math.min(Number(rawMaxN) || defaults.maxN, defaults.cap)),
    offset: Math.floor(Number(rawOffset) || 0),
    sort,
    error: null,
  };
}

/**
 * Data-source caveats echoed on screen responses so a consuming AI never
 * misreads the fields' provenance.
 */
export const DATA_NOTES =
  "Field provenance: 'consensus' is FMP's quant letter rating, NOT Street Buy/Hold consensus. " +
  "'analysts' counts FMP-tracked coverage (typically lower than S&P/MarketBeat counts); " +
  "premium.coveringAnalysts is the subset with scored accuracy track records. " +
  "'price' is the last pipeline quote (see priceAsOf — generally prior close intraday).";
