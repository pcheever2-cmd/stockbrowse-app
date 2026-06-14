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

type Identity = { userId: string; email: string; tier: SubscriptionTier };

// TTL for the cached identity below. The cache is keyed by token hash and expires ONLY by
// TTL — the Stripe webhook can't target it (it knows userId, not the token). So everything
// that changes a user's access takes effect within at most this window: a tier upgrade
// (just-paid user waits ≤TTL), a downgrade (retains premium ≤TTL), and a token revocation /
// sign-out (honored ≤TTL). Kept short and acceptable here because gated data is read-only
// (no destructive gated actions). Lower this value to tighten all three windows.
const AUTH_CACHE_TTL = 60; // seconds

/** SHA-256 hex of a string (used to key the auth cache without storing the raw token). */
async function sha256hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Authenticate the request and optionally enforce a minimum tier.
 * Returns the user identity or a 401/403 Response.
 *
 * Perf: a previously-validated token's identity is cached in KV (keyed by token hash)
 * for AUTH_CACHE_TTL, so repeat gated requests skip the Supabase getUser + profiles
 * round-trips (~80-150ms each). Only tokens that already validated get cached; an
 * unknown/forged token misses the cache and hits the full live validation.
 */
export async function requireAuth(
  env: Env,
  request: Request,
  minTier: SubscriptionTier = 'free'
): Promise<Identity | Response> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Authentication required' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const token = authHeader.slice(7);
  const cacheKey = `authcache:${await sha256hex(token)}`;

  // Cache hit → skip the two Supabase round-trips.
  let identity: Identity | null = null;
  try {
    identity = await env.STOCKS_PREMIUM_KV.get<Identity>(cacheKey, 'json');
  } catch {
    identity = null; // KV unavailable → fall through to live validation
  }

  if (!identity) {
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

    const { data: profile } = await supabase
      .from('profiles')
      .select('subscription_tier')
      .eq('id', user.id)
      .single();

    identity = {
      userId: user.id,
      email: user.email!,
      tier: (profile?.subscription_tier as SubscriptionTier) || 'free',
    };

    try {
      await env.STOCKS_PREMIUM_KV.put(cacheKey, JSON.stringify(identity), { expirationTtl: AUTH_CACHE_TTL });
    } catch {
      // Caching is best-effort; a put failure just means the next request re-validates.
    }
  }

  // Tier check is per-endpoint (minTier varies), so it stays out of the cached identity.
  if (!tierAtLeast(identity.tier, minTier)) {
    return new Response(JSON.stringify({ error: 'Upgrade required' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return identity;
}

/**
 * Constant-time string comparison for secret/token checks (avoids timing leaks).
 * Returns false on length mismatch or non-string input.
 */
export function safeEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
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
