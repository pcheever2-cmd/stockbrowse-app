/**
 * GET /api/private/screen — generic screen over the screener index.
 *
 * Same filter params as /api/private/ideas but NO profile defaults: only the
 * hard analyst filter applies unless the request sets thresholds. Mirrors the
 * site's browse filters (grades, sectors, price/cap ranges, golden,
 * catalystTag) plus the numeric params. maxN default 50 (cap 200),
 * sort default compass. `?why=1` adds the why[] strings.
 */
import { requireAssistantKey, privateJson, type AssistantEnv } from '../../lib/assistant-auth';
import { errorResponse } from '../../_middleware';
import {
  loadIndex, applyScreen, sortRows, buildWhy, parseScreenParams,
  PROFILES, DEFAULT_PROFILE, type SortKey,
} from '../../lib/screener';

export const onRequestGet: PagesFunction<AssistantEnv> = async ({ request, env }) => {
  const denied = requireAssistantKey(env, request);
  if (denied) return denied;

  const index = await loadIndex(env.STOCKS_PREMIUM_KV);
  if (index instanceof Response) return index;

  const url = new URL(request.url);
  const { params, errors } = parseScreenParams(url);
  if (errors.length) return errorResponse(`bad params: ${errors.join('; ')}`, 400);
  const maxNRaw = url.searchParams.get('maxN');
  if (maxNRaw && !Number.isFinite(Number(maxNRaw))) {
    return errorResponse(`maxN='${maxNRaw}' is not a number`, 400);
  }
  const maxN = Math.max(1, Math.min(Number(maxNRaw) || 50, 200));
  const sort = (url.searchParams.get('sort') || 'compass') as SortKey;
  if (!['rank', 'compass', 'catalyst', 'valuation', 'fvUpside'].includes(sort)) {
    return errorResponse(`unknown sort '${sort}' — valid: rank, compass, catalyst, valuation, fvUpside`, 400);
  }
  const withWhy = url.searchParams.get('why') === '1';
  const profile = PROFILES[DEFAULT_PROFILE]; // only used if sort=rank requested

  const matched = applyScreen(index.stocks, params);
  const items = sortRows(matched, sort, profile).slice(0, maxN).map(row =>
    withWhy ? { ...row, why: buildWhy(row) } : row
  );

  return privateJson({
    asOf: index.asOf,
    universe: index.count,
    matched: matched.length,
    returned: items.length,
    params,
    note: 'Hard filter: analysts >= 2 (always). No profile defaults on this endpoint.',
    items,
  });
};
