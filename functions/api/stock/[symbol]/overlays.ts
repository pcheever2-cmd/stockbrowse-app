/**
 * GET /api/stock/:symbol/overlays
 *
 * Valuation-multiple overlays for the price chart: daily trailing P/E and
 * EV/EBITDA series (computed server-side from raw close + filing-date-aligned
 * TTM fundamentals), plus the current forward P/E scalar for a reference line.
 *
 *   { "pe": [{time,value}], "evEbitda": [{time,value}], "fwdPe": <num|null> }
 *
 * Premium: the underlying valuation fields (forwardPe / evEbitda) are Plus-tier
 * elsewhere, so this endpoint requires Plus and is never shared-cached.
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

const EMPTY = '{"pe":[],"evEbitda":[],"fwdPe":null}';

export const onRequestGet: PagesFunction<Env> = async ({ params, env, request }) => {
  // Premium valuation overlays — Plus tier minimum.
  const auth = await requireAuth(env, request, 'plus');
  if (auth instanceof Response) return auth;

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
      // Premium, per-user payload — never let a shared/edge cache serve it to others.
      'Cache-Control': 'private, no-store',
      ...corsHeaders(),
    },
  });
};
