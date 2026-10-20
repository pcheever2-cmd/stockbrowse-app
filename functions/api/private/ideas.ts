/**
 * GET /api/private/ideas — the owner's philosophy screen.
 *
 * High-quality names (Compass) with recent positive catalysts (earnings beats,
 * upgrades), not expensive vs their OWN 5-yr P/E and EV/EBITDA history, with
 * analyst coverage (hard filter). Returns ranked candidates with a `why` array
 * per pick; the consuming AI reviews news (/api/private/news/{symbol}) and
 * makes the final call.
 *
 * Params: profile (default quality_catalyst) picks defaults + rank formula;
 * any screen param (minCompass, minCatalyst, maxPePctile, maxEvPctile,
 * grades, sectors, excludeSectors, minPrice/maxPrice, minMcapB/maxMcapB,
 * golden=1, catalystTag=1, includeNoHistory=1) overrides per request.
 * maxN default 25 (cap 100); sort: rank|compass|catalyst|valuation|fvUpside.
 */
import { requireAssistantKey, privateJson, type AssistantEnv } from '../../lib/assistant-auth';
import { errorResponse } from '../../_middleware';
import {
  loadIndex, applyScreen, sortRows, rankScore, buildWhy, parseScreenParams,
  parsePaging, PROFILES, DEFAULT_PROFILE, DATA_NOTES,
} from '../../lib/screener';

export const onRequestGet: PagesFunction<AssistantEnv> = async ({ request, env }) => {
  const denied = requireAssistantKey(env, request);
  if (denied) return denied;

  const url = new URL(request.url);
  const profileName = url.searchParams.get('profile') || DEFAULT_PROFILE;
  const profile = PROFILES[profileName];
  if (!profile) {
    return errorResponse(`unknown profile '${profileName}' — valid: ${Object.keys(PROFILES).join(', ')}`, 400);
  }

  const index = await loadIndex(env.STOCKS_PREMIUM_KV);
  if (index instanceof Response) return index;

  const { params, errors } = parseScreenParams(url, ['profile', 'maxN', 'offset', 'sort']);
  if (errors.length) return errorResponse(`bad params: ${errors.join('; ')}`, 400);
  const paging = parsePaging(url, { maxN: 25, cap: 100, sort: 'rank' });
  if (paging.error) return errorResponse(paging.error, 400);
  // Profile defaults apply wherever the request didn't override. Overrides can
  // loosen (maxPePctile=100) but never remove a default entirely.
  params.minCompass ??= profile.defaults.minCompass;
  params.minCatalyst ??= profile.defaults.minCatalyst;
  params.maxPePctile ??= profile.defaults.maxPePctile;
  params.maxEvPctile ??= profile.defaults.maxEvPctile;

  const matched = applyScreen(index.stocks, params);
  const items = sortRows(matched, paging.sort, profile)
    .slice(paging.offset, paging.offset + paging.maxN)
    .map(row => ({
      ...row,
      rankScore: Math.round(rankScore(row, profile) * 10) / 10,
      why: buildWhy(row),
    }));

  return privateJson({
    asOf: index.asOf,
    profile: profileName,
    universe: index.count,
    matched: matched.length,
    returned: items.length,
    offset: paging.offset,
    params,
    note:
      `${profile.formula}. Hard filter: analysts >= 2 (always). ` +
      'Valuation gates apply per multiple where 5-yr history exists; a missing side is noted in why[] ' +
      '(stocks with no history at all are excluded unless includeNoHistory=1). ' +
      'Momentum fields are context only — judge their relevance yourself. ' +
      'Review recent news per idea via /api/private/news/{symbol} before acting. ' +
      DATA_NOTES,
    items,
  });
};
