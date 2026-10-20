/**
 * GET /api/private/stock/{symbol} — full dossier for one stock.
 *
 * Joins: screener row (scores, valuation-vs-history, why[]) + the entire
 * premium KV payload + valuation history recomputed from the overlays series
 * (richer: min/max) + price context (52w drawdown, trailing returns) from the
 * daily price series. News is separate (/api/private/news/{symbol}) so this
 * stays fast and news caching lives in one place.
 */
import { requireAssistantKey, privateJson, type AssistantEnv } from '../../../lib/assistant-auth';
import { errorResponse } from '../../../_middleware';
import {
  loadIndex, buildWhy, buildFlags, rankScore, PROFILES, DEFAULT_PROFILE,
} from '../../../lib/screener';

interface SeriesPoint { time: string; value: number }
interface Overlays { pe: SeriesPoint[]; evEbitda: SeriesPoint[]; fwdPe: number | null }

const MIN_POINTS = 252;          // ~1 trading year — must match export_overlays_kv.py
const MAX_STALENESS_DAYS = 30;

function seriesStats(series: SeriesPoint[] | undefined) {
  if (!series || series.length < MIN_POINTS) return null;
  const last = series[series.length - 1];
  const ageDays = (Date.now() - new Date(last.time).getTime()) / 86_400_000;
  if (!Number.isFinite(ageDays) || ageDays > MAX_STALENESS_DAYS) return null;
  const values = series.map(p => p.value);
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const median = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  const now = last.value;
  return {
    now: Math.round(now * 100) / 100,
    median5y: Math.round(median * 100) / 100,
    percentile: Math.round((100 * values.filter(v => v <= now).length) / n),
    min: Math.round(sorted[0] * 100) / 100,
    max: Math.round(sorted[n - 1] * 100) / 100,
    n,
  };
}

function priceContext(prices: SeriesPoint[] | null) {
  if (!prices || prices.length < 2) return null;
  const last = prices[prices.length - 1];
  const lookback = (days: number): number | null => {
    const idx = prices.length - 1 - days;
    if (idx < 0) return null;
    const base = prices[idx].value;
    return base > 0 ? Math.round((last.value / base - 1) * 1000) / 10 : null;
  };
  const window52w = prices.slice(-252);
  const high52w = Math.max(...window52w.map(p => p.value));
  return {
    last: last.value,
    lastDate: last.time,
    high52w: Math.round(high52w * 100) / 100,
    pctFrom52wHigh: high52w > 0 ? Math.round((last.value / high52w - 1) * 1000) / 10 : null,
    ret1m: lookback(21),
    ret3m: lookback(63),
    ret6m: lookback(126),
    ret12m: lookback(252),
  };
}

export const onRequestGet: PagesFunction<AssistantEnv> = async ({ request, env, params }) => {
  const denied = requireAssistantKey(env, request);
  if (denied) return denied;

  const symbol = String(params.symbol || '').toUpperCase();
  if (!symbol || !/^[A-Z0-9.\-]{1,12}$/.test(symbol)) {
    return errorResponse('invalid symbol', 400);
  }

  const kv = env.STOCKS_PREMIUM_KV;
  const [index, premium, overlays, prices] = await Promise.all([
    loadIndex(kv),
    kv.get<Record<string, unknown>>(`stock:${symbol}`, 'json'),
    kv.get<Overlays>(`overlays:${symbol}`, 'json'),
    kv.get<SeriesPoint[]>(`prices:${symbol}`, 'json'),
  ]);

  const row = index instanceof Response
    ? null
    : index.stocks.find(r => r.symbol === symbol) ?? null;

  if (!row && !premium && !overlays && !prices) {
    return errorResponse(`${symbol} not found`, 404);
  }

  return privateJson({
    symbol,
    asOf: index instanceof Response ? null : index.asOf,
    screener: row
      ? {
          ...row,
          rankScore: Math.round(rankScore(row, PROFILES[DEFAULT_PROFILE]) * 10) / 10,
          why: buildWhy(row),
          flags: buildFlags(row),
        }
      : null,
    premium: premium ?? null,
    valuationHistory: {
      pe: seriesStats(overlays?.pe),
      evEbitda: seriesStats(overlays?.evEbitda),
      fwdPe: overlays?.fwdPe ?? null,
    },
    priceContext: priceContext(prices),
    newsHint: `GET /api/private/news/${symbol} for recent headlines`,
  });
};
