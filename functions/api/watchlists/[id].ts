/**
 * GET    /api/watchlists/:id — get a single watchlist with items
 * PATCH  /api/watchlists/:id — rename a watchlist
 * DELETE /api/watchlists/:id — delete a watchlist
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

function getSupabase(env: Env, request: Request) {
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: request.headers.get('Authorization')! } },
  });
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const auth = await requireAuth(context.env, context.request, 'plus');
  if (auth instanceof Response) return auth;

  const id = context.params.id as string;
  const supabase = getSupabase(context.env, context.request);

  const { data, error } = await supabase
    .from('watchlists')
    .select(`id, name, created_at, watchlist_items (symbol, added_at)`)
    .eq('id', id)
    .eq('user_id', auth.userId)
    .single();

  if (error || !data) return errorResponse('Watchlist not found', 404);
  return json(data);
};

export const onRequestPatch: PagesFunction<Env> = async (context) => {
  const auth = await requireAuth(context.env, context.request, 'plus');
  if (auth instanceof Response) return auth;

  const id = context.params.id as string;
  let body: { name: string };
  try {
    body = await context.request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const supabase = getSupabase(context.env, context.request);
  const { data, error } = await supabase
    .from('watchlists')
    .update({ name: body.name })
    .eq('id', id)
    .eq('user_id', auth.userId)
    .select()
    .single();

  if (error || !data) return errorResponse('Watchlist not found', 404);
  return json(data);
};

export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const auth = await requireAuth(context.env, context.request, 'plus');
  if (auth instanceof Response) return auth;

  const id = context.params.id as string;
  const supabase = getSupabase(context.env, context.request);

  const { error } = await supabase
    .from('watchlists')
    .delete()
    .eq('id', id)
    .eq('user_id', auth.userId);

  if (error) return errorResponse('Failed to delete watchlist', 500);
  return json({ deleted: true });
};
