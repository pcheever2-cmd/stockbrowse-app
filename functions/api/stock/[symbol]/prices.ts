/**
 * GET /api/stock/:symbol/prices
 *
 * Daily closing prices for the symbol, shaped for lightweight-charts:
 *
 *   [{ "time": "2021-05-28", "value": 148.21 }, ...]   // ascending by date
 *
 * Tiered per PRODUCT_TIERS.md: anonymous / free / newsletter get the trailing
 * ~1 year; Plus and Pro get the full ~5-year history. Synced daily from
 * backtest.db into sharded KV keys (prices:AAPL, ...). Missing names return [].
 */
import { requireAuth, corsHeaders } from '../../../_middleware';

interface Env {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  STOCKS_PREMIUM_KV: KVNamespace;
}

// Free-tier depth: trailing ~1 year of daily points.
const FREE_DAYS = 366;

export const onRequestGet: PagesFunction<Env> = async ({ params, env, request }) => {
  const raw = Array.isArray(params.symbol) ? params.symbol[0] : params.symbol;
  const symbol = (raw || '').toUpperCase();
  if (!symbol) {
    return new Response(JSON.stringify({ error: 'symbol required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    });
  }

  // Optional auth: Plus+ gets the full 5yr; everyone else gets the trailing ~1yr.
  // Anonymous requests (no Bearer header) short-circuit in requireAuth with no
  // Supabase round-trip, so the common public path stays cheap.
  const auth = await requireAuth(env, request, 'plus');
  const isPlus = !(auth instanceof Response);

  const stored = await env.STOCKS_PREMIUM_KV.get(`prices:${symbol}`);

  if (isPlus) {
    // Full history — per-user entitlement, so never let a shared cache hold it.
    return new Response(stored ?? '[]', {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'private, max-age=3600',
        ...corsHeaders(),
      },
    });
  }

  // Truncate to the trailing ~1yr for free/anon (series is ascending by date).
  let body = '[]';
  if (stored) {
    try {
      const series = JSON.parse(stored) as Array<{ time: string; value: number }>;
      const cutoff = new Date(Date.now() - FREE_DAYS * 86400000).toISOString().slice(0, 10);
      body = JSON.stringify(series.filter((p) => p && p.time >= cutoff));
    } catch {
      body = '[]';
    }
  }
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      // Public 1yr payload; Vary on Authorization so a cache never serves this
      // to (or caches) a Plus request's full-history response.
      'Cache-Control': 'public, max-age=3600',
      Vary: 'Authorization',
      ...corsHeaders(),
    },
  });
};
