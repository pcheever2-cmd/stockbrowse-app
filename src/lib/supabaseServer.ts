/**
 * Supabase server client factory — used inside Cloudflare Pages Functions.
 * Uses the service-role key to bypass RLS for trusted operations
 * (e.g., Stripe webhook updating subscription_tier).
 *
 * For user-scoped operations, use createUserClient() which validates
 * the user's JWT and respects RLS.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

interface Env {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}

/**
 * Creates a Supabase client with the service-role key (bypasses RLS).
 * Only use this in trusted server-side contexts (webhooks, admin ops).
 */
export function createServiceClient(env: Env): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
}

/**
 * Creates a Supabase client scoped to the authenticated user.
 * Validates the JWT from the Authorization header and respects RLS.
 * Returns null if the token is missing or invalid.
 */
export async function createUserClient(
  env: Env,
  request: Request
): Promise<{ client: SupabaseClient; userId: string } | null> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;

  const token = authHeader.slice(7);
  const client = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: { user }, error } = await client.auth.getUser(token);
  if (error || !user) return null;

  return { client, userId: user.id };
}
