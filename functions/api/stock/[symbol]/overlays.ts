/**
 * GET /api/stock/:symbol/overlays
 *
 * Valuation-multiple overlays for the price chart: daily trailing P/E and
 * EV/EBITDA series (computed server-side from raw close + filing-date-aligned
 * TTM fundamentals), plus the current forward P/E scalar for a reference line.
 *
 *   { "pe": [{time,value}], "evEbitda": [{time,value}], "fwdPe": <num|null> }
 *
 * Pass-through of the `overlays:SYM` KV value. Returns an empty payload when a
 * symbol has no usable multiples (unprofitable / sparse fundamentals) so the
 * client just leaves the overlay toggles disabled.
 *
 * NOTE: currently public, matching the public price chart. The underlying
 * valuation fields (forwardPe/evEbitda) are premium elsewhere — if we decide to
 * gate this, swap to requireAuth('plus') like functions/api/stocks/premium.ts.
 */
import { corsHeaders } from '../../../_middleware';

interface Env {
  STOCKS_PREMIUM_KV: KVNamespace;
}

const EMPTY = '{"pe":[],"evEbitda":[],"fwdPe":null}';

export const onRequestGet: PagesFunction<Env> = async ({ params, env }) => {
  const raw = Array.isArray(params.symbol) ? params.symbol[0] : params.symbol;
  const symbol = (raw || '').toUpperCase();
  if (!symbol) {
    return new Response(JSON.stringify({ error: 'symbol required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    });
  }

  const data = await env.STOCKS_PREMIUM_KV.get(`overlays:${symbol}`);
  return new Response(data ?? EMPTY, {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600',
      ...corsHeaders(),
    },
  });
};
