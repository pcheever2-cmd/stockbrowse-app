/**
 * Shared middleware for all Pages Functions.
 * Provides auth helpers, CORS, and error handling.
 */
import { createClient } from '@supabase/supabase-js';

interface Env {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  STOCKS_PREMIUM_KV: KVNamespace;
}

type SubscriptionTier = 'free' | 'newsletter' | 'plus' | 'pro';

const TIER_ORDER: SubscriptionTier[] = ['free', 'newsletter', 'plus', 'pro'];

/**
 * Check if tierA >= tierB in the hierarchy.
 */
function tierAtLeast(tierA: SubscriptionTier, tierB: SubscriptionTier): boolean {
  return TIER_ORDER.indexOf(tierA) >= TIER_ORDER.indexOf(tierB);
}

/**
 * Authenticate the request and optionally enforce a minimum tier.
 * Returns the user profile or a 401/403 Response.
 */
export async function requireAuth(
  env: Env,
  request: Request,
  minTier: SubscriptionTier = 'free'
): Promise<{ userId: string; email: string; tier: SubscriptionTier } | Response> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Authentication required' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const token = authHeader.slice(7);
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) {
    return new Response(JSON.stringify({ error: 'Invalid or expired token' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Fetch tier from profiles table
  const { data: profile } = await supabase
    .from('profiles')
    .select('subscription_tier')
    .eq('id', user.id)
    .single();

  const tier = (profile?.subscription_tier as SubscriptionTier) || 'free';

  // Check minimum tier
  if (!tierAtLeast(tier, minTier)) {
    return new Response(JSON.stringify({ error: 'Upgrade required' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return { userId: user.id, email: user.email!, tier };
}

/**
 * Add CORS headers to a response.
 */
export function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

/**
 * Handle OPTIONS preflight requests.
 */
export function handleOptions(): Response {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

/**
 * JSON response helper.
 */
export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

/**
 * Error response helper. Never exposes premium field names.
 */
export function errorResponse(message: string, status: number): Response {
  return json({ error: message }, status);
}

// Middleware chain — handles CORS preflight for all /api/* routes
export const onRequest: PagesFunction<Env> = async (context) => {
  if (context.request.method === 'OPTIONS') {
    return handleOptions();
  }
  // Continue to the actual handler
  const response = await context.next();
  // Add CORS headers to all responses
  const headers = new Headers(response.headers);
  Object.entries(corsHeaders()).forEach(([k, v]) => headers.set(k, v));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};
