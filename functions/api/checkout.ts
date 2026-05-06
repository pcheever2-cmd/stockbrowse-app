/**
 * POST /api/checkout
 * Creates a Stripe Checkout session for the requested tier.
 * Body: { tier: 'newsletter' | 'plus' | 'pro', annual?: boolean }
 * Returns: { url: string } — redirect the user to this URL.
 */
import Stripe from 'stripe';
import { requireAuth, json, errorResponse } from '../_middleware';

interface Env {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  STOCKS_PREMIUM_KV: KVNamespace;
}

// Map tier to Stripe Product ID.
// The checkout flow looks up the correct Price automatically from the product.
const PRODUCT_IDS: Record<string, string> = {
  'newsletter': 'prod_USo0WGwfiIcxqT',
  'plus': 'prod_USo32e2kMoaXVS',
  'pro': 'prod_USo9k60n0wpxdj',
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  // Must be authenticated (any tier can initiate checkout)
  const auth = await requireAuth(env, request, 'free');
  if (auth instanceof Response) return auth;

  let body: { tier: string; annual?: boolean };
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const { tier, annual } = body;
  if (!tier || !['newsletter', 'plus', 'pro'].includes(tier)) {
    return errorResponse('Invalid tier', 400);
  }

  const productId = PRODUCT_IDS[tier];
  if (!productId) {
    return errorResponse('Product not configured', 500);
  }

  const stripe = new Stripe(env.STRIPE_SECRET_KEY);

  // Look up the correct price from the product (monthly or annual)
  const prices = await stripe.prices.list({
    product: productId,
    active: true,
    type: 'recurring',
  });

  // Find the price matching the requested billing interval
  const targetInterval = annual ? 'year' : 'month';
  const price = prices.data.find(p => p.recurring?.interval === targetInterval);

  if (!price) {
    return errorResponse(`No ${targetInterval}ly price found for this product`, 500);
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [{ price: price.id, quantity: 1 }],
    success_url: `${new URL(request.url).origin}/account?checkout=success`,
    cancel_url: `${new URL(request.url).origin}/pricing?checkout=cancelled`,
    client_reference_id: auth.userId,
    customer_email: auth.email,
    metadata: {
      userId: auth.userId,
      tier,
    },
  });

  return json({ url: session.url });
};
