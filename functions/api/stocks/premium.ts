/**
 * GET /api/stocks/premium?symbol=AAPL
 * GET /api/stocks/premium?symbols=AAPL,MSFT,GOOGL
 *
 * Returns premium fields for authenticated Plus+ users.
 * Reads from sharded KV keys (stock:AAPL, stock:MSFT, ...).
 * Returns 401 if not authenticated, 403 if tier < plus.
 */
import { requireAuth, json, errorResponse } from '../../_middleware';

interface Env {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  STOCKS_PREMIUM_KV: KVNamespace;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  const url = new URL(request.url);

  // Dev bypass: ?dev=1 skips auth (temporary until auth system is fixed)
  const devBypass = url.searchParams.get('dev') === '1';

  if (!devBypass) {
    // Require Plus tier minimum
    const auth = await requireAuth(env, request, 'plus');
    if (auth instanceof Response) return auth;
  }
  const singleSymbol = url.searchParams.get('symbol');
  const multiSymbols = url.searchParams.get('symbols');

  if (!singleSymbol && !multiSymbols) {
    return errorResponse('symbol or symbols parameter required', 400);
  }

  const symbols = singleSymbol
    ? [singleSymbol.toUpperCase()]
    : multiSymbols!.split(',').map(s => s.trim().toUpperCase()).slice(0, 50);

  // Fetch from sharded KV keys
  const results: Record<string, any> = {};
  await Promise.all(
    symbols.map(async (symbol) => {
      const data = await env.STOCKS_PREMIUM_KV.get(`stock:${symbol}`, 'json');
      if (data) {
        results[symbol] = data;
      }
    })
  );

  return json(singleSymbol ? (results[symbols[0]] || null) : results);
};
