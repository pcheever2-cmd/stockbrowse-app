/**
 * POST /api/webhooks/stripe
 * Handles Stripe webhook events. Verifies signature, processes allowlisted events,
 * and updates the user's subscription_tier in Supabase.
 *
 * Idempotent via stripe_events table — duplicate event IDs are skipped.
 *
 * Ordering is load-bearing: check-duplicate → process → mark-processed LAST.
 * Marking first lost paid upgrades permanently: a transient failure after the
 * mark 500'd, Stripe retried, and the retry hit the duplicate branch ("Already
 * processed") while the tier was never written. Every handler write is also
 * error-checked (supabase-js returns {error}, it does NOT throw) — critical
 * writes throw so we return non-200 and Stripe retries; audit_log is
 * best-effort. Re-processing on retry is safe: all writes are idempotent
 * state-sets. A concurrent duplicate delivery can double-process (both pass
 * the read check) — benign for the same reason; the second mark hits 23505.
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

/**
 * Returns the subscription's current period end as an ISO string, or null.
 * As of API version 2025-03-31.basil, `current_period_end` moved from the
 * Subscription onto its items. Read item-level first, then fall back to the
 * legacy top-level field so this works regardless of the account's API version.
 */
function periodEndISO(subscription: Stripe.Subscription): string | null {
  const periodEnd =
    subscription.items.data[0]?.current_period_end ??
    (subscription as unknown as { current_period_end?: number }).current_period_end;
  return periodEnd ? new Date(periodEnd * 1000).toISOString() : null;
}

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

  // Idempotency check (read-only) — skip if we've already processed this event.
  // The mark is written AFTER successful processing, at the bottom.
  const { data: seen, error: seenError } = await supabase
    .from('stripe_events')
    .select('event_id')
    .eq('event_id', event.id)
    .maybeSingle();
  if (seenError) {
    // Can't verify idempotency — let Stripe retry rather than risk double/none.
    return new Response('Idempotency check failed', { status: 500 });
  }
  if (seen) {
    return new Response('Already processed', { status: 200 });
  }

  // Throws on a failed critical write so the catch below returns non-200.
  const mustSucceed = (label: string) => ({ error }: { error: { message?: string } | null }) => {
    if (error) throw new Error(`${label}: ${error.message || 'unknown supabase error'}`);
  };
  // Audit rows are best-effort: never fail the event (and force a retry loop)
  // over a missing log line.
  const bestEffort = (label: string) => ({ error }: { error: { message?: string } | null }) => {
    if (error) console.error(`stripe-webhook audit (non-fatal) ${label}: ${error.message}`);
  };

  try {
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
        const tier = TIER_MAP[productId] || 'free'; // unknown product → least privilege, never auto-grant paid

        // .select('id') so a 0-row match is detectable: PostgREST returns
        // error:null when an UPDATE matches nothing (e.g. profile row not
        // created yet) — that must throw and retry, not mark-processed.
        const { data: updatedRows, error: updateErr } = await supabase
          .from('profiles')
          .update({
            subscription_tier: tier,
            stripe_customer_id: session.customer as string,
            current_period_end: periodEndISO(subscription),
          })
          .eq('id', userId)
          .select('id');
        if (updateErr) throw new Error(`checkout tier update: ${updateErr.message}`);
        if (!updatedRows?.length) throw new Error(`checkout tier update matched no profile for ${userId}`);

        // Audit log (event_id included so retry-duplicates are traceable)
        await supabase.from('audit_log').insert({
          user_id: userId,
          event_type: 'subscription_created',
          payload: { tier, stripe_customer_id: session.customer, event_id: event.id },
        }).then(bestEffort('subscription_created'));
      }
      break;
    }

    case 'customer.subscription.updated': {
      const subscription = event.data.object as Stripe.Subscription;
      const customerId = subscription.customer as string;
      const productId = subscription.items.data[0]?.price?.product as string;
      const tier = TIER_MAP[productId] || 'free'; // unknown product → least privilege, never auto-grant paid

      // Tier follows subscription STATUS alone: active/trialing keep the paid
      // tier; past_due/unpaid/canceled/etc downgrade. cancel_at_period_end
      // must NOT downgrade early — the .deleted event handles period end.
      // (Old logic kept paid tier on 'unpaid' forever and dropped trialing
      // users with a scheduled cancel immediately.)
      const actualTier =
        subscription.status === 'active' || subscription.status === 'trialing' ? tier : 'free';

      // 0-row match throws: checkout.session.completed (which writes
      // stripe_customer_id) can arrive AFTER this event — retrying later heals
      // the ordering instead of silently no-opping.
      const { data: updRows, error: updErr } = await supabase
        .from('profiles')
        .update({
          subscription_tier: actualTier,
          current_period_end: periodEndISO(subscription),
        })
        .eq('stripe_customer_id', customerId)
        .select('id');
      if (updErr) throw new Error(`subscription.updated tier update: ${updErr.message}`);
      if (!updRows?.length) throw new Error(`subscription.updated matched no profile for ${customerId} (checkout may not have landed yet)`);

      break;
    }

    case 'customer.subscription.deleted': {
      const subscription = event.data.object as Stripe.Subscription;
      const customerId = subscription.customer as string;

      await supabase
        .from('profiles')
        .update({ subscription_tier: 'free', current_period_end: null })
        .eq('stripe_customer_id', customerId)
        .then(mustSucceed('subscription.deleted downgrade'));

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
          payload: { stripe_customer_id: customerId, event_id: event.id },
        }).then(bestEffort('subscription_cancelled'));
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
        }).then(bestEffort('payment_failed'));
      }
      break;
    }

    default:
      // Unhandled event type — log and ignore
      break;
  }
  } catch (err: any) {
    // Processing failed BEFORE the event was marked — return non-200 so Stripe
    // retries and the tier change is never silently lost.
    console.error(`stripe-webhook processing failed for ${event.id} (${event.type}): ${err?.message}`);
    return new Response('Event processing failed, retry', { status: 500 });
  }

  // Mark processed ONLY after successful handling. If this insert itself fails,
  // Stripe retries and re-processing is safe (idempotent state-sets); a
  // concurrent duplicate hits the unique constraint here — also fine.
  const { error: markError } = await supabase
    .from('stripe_events')
    .insert({ event_id: event.id });
  if (markError && markError.code !== '23505') {
    return new Response('Failed to record event, retry', { status: 500 });
  }

  return new Response('OK', { status: 200 });
};
