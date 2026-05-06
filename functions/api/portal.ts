/**
 * POST /api/portal
 * Creates a Stripe Customer Portal session for the authenticated user.
 * Lets them manage billing, cancel, update payment method — we never build this UI.
 * Returns: { url: string }
 */
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { requireAuth, json, errorResponse } from '../_middleware';

interface Env {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  STOCKS_PREMIUM_KV: KVNamespace;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  const auth = await requireAuth(env, request, 'newsletter');
  if (auth instanceof Response) return auth;

  // Get Stripe customer ID from profile
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  const { data: profile } = await supabase
    .from('profiles')
    .select('stripe_customer_id')
    .eq('id', auth.userId)
    .single();

  if (!profile?.stripe_customer_id) {
    return errorResponse('No billing account found', 404);
  }

  const stripe = new Stripe(env.STRIPE_SECRET_KEY);
  const session = await stripe.billingPortal.sessions.create({
    customer: profile.stripe_customer_id,
    return_url: `${new URL(request.url).origin}/account`,
  });

  return json({ url: session.url });
};
