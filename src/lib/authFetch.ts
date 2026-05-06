/**
 * Authenticated fetch wrapper for client-side API calls to Pages Functions.
 * Reads the Supabase access token and sends it as a Bearer header.
 *
 * Usage:
 *   const data = await authFetch('/api/stocks/premium?symbol=AAPL');
 *   const result = await authFetch('/api/watchlists', {
 *     method: 'POST',
 *     body: JSON.stringify({ name: 'My Watchlist', symbols: ['AAPL'] }),
 *   });
 */
import { getAccessToken } from './supabase';

export async function authFetch(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const token = await getAccessToken();

  const headers = new Headers(options.headers);
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }

  return fetch(url, { ...options, headers });
}
