/**
 * GET  /api/private/portfolio-check?symbols=AAPL,MSFT,...
 * POST /api/private/portfolio-check  {"symbols": ["AAPL", ...]}
 *
 * For held positions: each symbol's current screener row + why[] + rule-based
 * `flags[]` cautions (expensive vs own history, net downgrades, fair-value
 * Overvalued, coverage lost, not in universe). Flags are pointers, never
 * verdicts — the consuming AI does the synthesis. Cap 100 symbols.
 */
import { requireAssistantKey, privateJson, type AssistantEnv } from '../../lib/assistant-auth';
import { errorResponse } from '../../_middleware';
import {
  loadIndex, buildWhy, buildFlags, rankScore, PROFILES, DEFAULT_PROFILE,
  type ScreenerRow,
} from '../../lib/screener';

async function check(env: AssistantEnv, symbols: string[]): Promise<Response> {
  const cleaned = [...new Set(symbols.map(s => s.trim().toUpperCase()).filter(Boolean))].slice(0, 100);
  if (!cleaned.length) return errorResponse('symbols required', 400);

  const index = await loadIndex(env.STOCKS_PREMIUM_KV);
  if (index instanceof Response) return index;

  const bySymbol = new Map<string, ScreenerRow>(index.stocks.map(r => [r.symbol, r]));
  const holdings = cleaned.map(symbol => {
    const row = bySymbol.get(symbol);
    if (!row) {
      return { symbol, inUniverse: false, flags: ['not in universe (no score coverage)'] };
    }
    return {
      ...row,
      inUniverse: true,
      rankScore: Math.round(rankScore(row, PROFILES[DEFAULT_PROFILE]) * 10) / 10,
      why: buildWhy(row),
      flags: buildFlags(row),
    };
  });

  return privateJson({
    asOf: index.asOf,
    checked: holdings.length,
    flagged: holdings.filter(h => h.flags.length > 0).length,
    note: 'Flags are rule-based cautions, not verdicts — synthesis belongs to the consuming AI.',
    holdings,
  });
}

export const onRequestGet: PagesFunction<AssistantEnv> = async ({ request, env }) => {
  const denied = requireAssistantKey(env, request);
  if (denied) return denied;
  const raw = new URL(request.url).searchParams.get('symbols') || '';
  return check(env, raw.split(','));
};

export const onRequestPost: PagesFunction<AssistantEnv> = async ({ request, env }) => {
  const denied = requireAssistantKey(env, request);
  if (denied) return denied;
  let body: { symbols?: unknown };
  try {
    body = await request.json();
  } catch {
    return errorResponse('invalid JSON body', 400);
  }
  if (!Array.isArray(body.symbols)) return errorResponse('symbols array required', 400);
  return check(env, body.symbols.map(String));
};
