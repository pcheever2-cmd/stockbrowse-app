/**
 * POST /api/newsletter/subscribe
 * Newsletter is a $1/mo paid tier. This endpoint creates a Stripe Checkout
 * session for the Newsletter price, then the Stripe webhook upgrades the
 * user's tier to 'newsletter' on successful payment.
 *
 * Body: { email: string }
 *
 * If the user is already authenticated: creates checkout with their userId.
 * If not authenticated: creates a Supabase account first (auto-generated password),
 * then creates checkout. The user will need to set a real password via email.
 */
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { json, errorResponse } from '../../_middleware';

interface Env {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  STOCKS_PREMIUM_KV: KVNamespace;
}

const NEWSLETTER_PRODUCT_ID = 'prod_USo0WGwfiIcxqT';

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  let body: { email: string };
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const email = body.email?.trim().toLowerCase();
  if (!email || !email.includes('@')) {
    return errorResponse('Valid email required', 400);
  }

  // Also store in newsletter_subscribers for the Resend Broadcasts list
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  await supabase
    .from('newsletter_subscribers')
    .upsert({ email, source: 'website' }, { onConflict: 'email' });

  // Check if user is already authenticated
  const authHeader = request.headers.get('Authorization');
  let userId: string | undefined;

  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    const anonClient = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: { user } } = await anonClient.auth.getUser(token);
    userId = user?.id;
  }

  // Look up newsletter price dynamically from the product
  const stripe = new Stripe(env.STRIPE_SECRET_KEY);
  const prices = await stripe.prices.list({
    product: NEWSLETTER_PRODUCT_ID,
    active: true,
    type: 'recurring',
    limit: 1,
  });

  if (!prices.data.length) {
    // Newsletter price not configured yet — just store the email for now
    return json({
      message: 'Thanks for subscribing! Newsletter launching soon.',
      stored: true,
    });
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [{ price: prices.data[0].id, quantity: 1 }],
    success_url: `${new URL(request.url).origin}/insights?subscribed=true`,
    cancel_url: `${new URL(request.url).origin}/insights`,
    customer_email: email,
    metadata: {
      userId: userId || '',
      tier: 'newsletter',
    },
  });

  return json({ url: session.url });
};
