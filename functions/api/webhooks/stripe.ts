/**
 * POST /api/webhooks/stripe
 * Handles Stripe webhook events. Verifies signature, processes allowlisted events,
 * and updates the user's subscription_tier in Supabase.
 *
 * Idempotent via stripe_events table — duplicate event IDs are skipped.
 */
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
}

const TIER_MAP: Record<string, string> = {
  'prod_USo0WGwfiIcxqT': 'newsletter',
  'prod_USo32e2kMoaXVS': 'plus',
  'prod_USo9k60n0wpxdj': 'pro',
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  const stripe = new Stripe(env.STRIPE_SECRET_KEY);
  const body = await request.text();
  const signature = request.headers.get('stripe-signature');

  if (!signature) {
    return new Response('Missing signature', { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature, env.STRIPE_WEBHOOK_SECRET);
  } catch (err: any) {
    return new Response(`Webhook signature verification failed: ${err.message}`, { status: 400 });
  }

  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  // Idempotency check — skip if we've already processed this event
  const { error: insertError } = await supabase
    .from('stripe_events')
    .insert({ event_id: event.id });

  if (insertError?.code === '23505') {
    // Unique violation — already processed
    return new Response('Already processed', { status: 200 });
  }

  // Only handle allowlisted event types
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.metadata?.userId || session.client_reference_id;
      if (!userId) break;

      // Get the subscription to determine the product/tier
      if (session.subscription) {
        const subscription = await stripe.subscriptions.retrieve(session.subscription as string);
        const productId = subscription.items.data[0]?.price?.product as string;
        const tier = TIER_MAP[productId] || 'plus';

        await supabase
          .from('profiles')
          .update({
            subscription_tier: tier,
            stripe_customer_id: session.customer as string,
            current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
          })
          .eq('id', userId);

        // Audit log
        await supabase.from('audit_log').insert({
          user_id: userId,
          event_type: 'subscription_created',
          payload: { tier, stripe_customer_id: session.customer },
        });
      }
      break;
    }

    case 'customer.subscription.updated': {
      const subscription = event.data.object as Stripe.Subscription;
      const customerId = subscription.customer as string;
      const productId = subscription.items.data[0]?.price?.product as string;
      const tier = TIER_MAP[productId] || 'plus';

      const newTier = subscription.cancel_at_period_end ? 'free' : tier;
      // Only downgrade to free when the period actually ends
      const actualTier = subscription.status === 'active' ? tier : newTier;

      await supabase
        .from('profiles')
        .update({
          subscription_tier: actualTier,
          current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
        })
        .eq('stripe_customer_id', customerId);

      break;
    }

    case 'customer.subscription.deleted': {
      const subscription = event.data.object as Stripe.Subscription;
      const customerId = subscription.customer as string;

      await supabase
        .from('profiles')
        .update({ subscription_tier: 'free', current_period_end: null })
        .eq('stripe_customer_id', customerId);

      // Audit log
      const { data: profile } = await supabase
        .from('profiles')
        .select('id')
        .eq('stripe_customer_id', customerId)
        .single();

      if (profile) {
        await supabase.from('audit_log').insert({
          user_id: profile.id,
          event_type: 'subscription_cancelled',
          payload: { stripe_customer_id: customerId },
        });
      }
      break;
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object as Stripe.Invoice;
      const customerId = invoice.customer as string;

      // Audit log — don't downgrade yet (Stripe retries)
      const { data: profile } = await supabase
        .from('profiles')
        .select('id')
        .eq('stripe_customer_id', customerId)
        .single();

      if (profile) {
        await supabase.from('audit_log').insert({
          user_id: profile.id,
          event_type: 'payment_failed',
          payload: { invoice_id: invoice.id },
        });
      }
      break;
    }

    default:
      // Unhandled event type — log and ignore
      break;
  }

  return new Response('OK', { status: 200 });
};
