/**
 * Supabase browser client — used in client-side scripts on Astro pages.
 * Uses the anon key (public, safe to embed in client JS).
 * Auth tokens are stored in localStorage by the Supabase SDK.
 *
 * For Pages Functions (server-side), use supabaseServer.ts instead.
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/**
 * Get the current session's access token, or null if not logged in.
 * Used by authFetch() to send authenticated requests to Pages Functions.
 */
export async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
