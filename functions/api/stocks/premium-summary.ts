/**
 * GET /api/stocks/premium-summary
 *
 * Returns the compact premium-filter map for the WHOLE universe in ONE response:
 *   { "AAPL": { catalystTag?, catalystScore?, isGolden?, valuationRating? }, ... }
 *
 * Reads a single KV key (summary:premium-filters) instead of ~85 per-symbol round-trips,
 * so the browse-page Catalyst/Golden/Valuation filters hydrate near-instantly.
 * Plus tier minimum; valuationRating (a Pro-only feature) is stripped for non-Pro.
 */
import { requireAuth, json } from '../../_middleware';

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

  const auth = await requireAuth(env, request, 'plus');
  if (auth instanceof Response) return auth;

  const raw = await env.STOCKS_PREMIUM_KV.get('summary:premium-filters');
  const data: Record<string, any> = raw ? JSON.parse(raw) : {};

  // Valuation Score is Pro-only — strip valuationRating for anyone below Pro.
  if (auth.tier !== 'pro') {
    for (const k in data) {
      if (data[k]?.valuationRating) delete data[k].valuationRating;
    }
  }

  return json(data);
};
