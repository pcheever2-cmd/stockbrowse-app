/**
 * GET /api/stock/:symbol/prices
 *
 * Public (no auth). Returns ~5 years of daily closing prices for the symbol,
 * already in the shape lightweight-charts consumes — this Function is a pure
 * pass-through of the KV value:
 *
 *   [{ "time": "2021-05-28", "value": 148.21 }, ...]   // ascending by date
 *
 * Data is synced daily from backtest.db by the stock-research pipeline into
 * sharded KV keys (prices:AAPL, ...). Missing/thin names return [] so the
 * client hides the chart gracefully.
 */
import { corsHeaders } from '../../../_middleware';

interface Env {
  STOCKS_PREMIUM_KV: KVNamespace;
}

export const onRequestGet: PagesFunction<Env> = async ({ params, env }) => {
  const raw = Array.isArray(params.symbol) ? params.symbol[0] : params.symbol;
  const symbol = (raw || '').toUpperCase();
  if (!symbol) {
    return new Response(JSON.stringify({ error: 'symbol required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    });
  }

  // Stored as a JSON string; pass it through verbatim to avoid re-serializing.
  const series = await env.STOCKS_PREMIUM_KV.get(`prices:${symbol}`);
  const body = series ?? '[]';

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      // History changes at most once/day — let the edge cache it.
      'Cache-Control': 'public, max-age=3600',
      ...corsHeaders(),
    },
  });
};
