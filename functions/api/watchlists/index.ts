/**
 * GET  /api/watchlists — list user's watchlists
 * POST /api/watchlists — create a new watchlist
 *
 * Plus = max 1 watchlist, Pro = max 5.
 */
import { createClient } from '@supabase/supabase-js';
import { requireAuth, json, errorResponse } from '../../_middleware';

interface Env {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  STOCKS_PREMIUM_KV: KVNamespace;
}

const MAX_WATCHLISTS: Record<string, number> = {
  plus: 1,
  pro: 5,
};

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const auth = await requireAuth(context.env, context.request, 'plus');
  if (auth instanceof Response) return auth;

  const supabase = createClient(context.env.SUPABASE_URL, context.env.SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: context.request.headers.get('Authorization')! } },
  });

  const { data: watchlists, error } = await supabase
    .from('watchlists')
    .select(`
      id, name, created_at,
      watchlist_items (symbol, added_at)
    `)
    .eq('user_id', auth.userId)
    .order('created_at', { ascending: true });

  if (error) return errorResponse('Failed to load watchlists', 500);
  return json(watchlists);
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const auth = await requireAuth(context.env, context.request, 'plus');
  if (auth instanceof Response) return auth;

  const supabase = createClient(context.env.SUPABASE_URL, context.env.SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: context.request.headers.get('Authorization')! } },
  });

  // Check watchlist limit
  const { count } = await supabase
    .from('watchlists')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', auth.userId);

  const maxAllowed = MAX_WATCHLISTS[auth.tier] || 1;
  if ((count ?? 0) >= maxAllowed) {
    return errorResponse(
      `${auth.tier === 'plus' ? 'Plus' : 'Pro'} tier allows up to ${maxAllowed} watchlist(s). Upgrade for more.`,
      403
    );
  }

  let body: { name?: string; symbols?: string[] };
  try {
    body = await context.request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const name = body.name || 'My Watchlist';

  // Create watchlist
  const { data: watchlist, error } = await supabase
    .from('watchlists')
    .insert({ user_id: auth.userId, name })
    .select()
    .single();

  if (error) return errorResponse('Failed to create watchlist', 500);

  // Bulk-add symbols if provided (migration from localStorage)
  if (body.symbols?.length) {
    const items = body.symbols.slice(0, 200).map(symbol => ({
      watchlist_id: watchlist.id,
      symbol: symbol.toUpperCase(),
    }));
    await supabase.from('watchlist_items').insert(items);
  }

  return json(watchlist, 201);
};
