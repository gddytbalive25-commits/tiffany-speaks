import Stripe from 'stripe';
import type { PoolConnection } from 'mysql2/promise';
import { getPool } from './db.js';

let stripeClient: Stripe | null = null;
function stripe(): Stripe {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) throw new Error('Stripe is not enabled for this runtime.');
  if (!stripeClient) stripeClient = new Stripe(secret);
  return stripeClient;
}

export function offerings() {
  const key = process.env.STRIPE_SECRET_KEY ?? '';
  return {
    oneTimeReady: Boolean(process.env.STRIPE_ONE_TIME_PRICE_ID),
    subscriptionReady: Boolean(process.env.STRIPE_SUBSCRIPTION_PRICE_ID),
    stripeReady: Boolean(key),
    mode: key.startsWith('sk_test_') ? 'test' as const : key.startsWith('sk_live_') ? 'live' as const : 'not configured' as const,
  };
}

export async function createCheckoutSession(input: {
  plan: 'one_time' | 'subscription';
  buyerId: string;
  email: string | null;
  origin: string;
}) {
  const priceId = input.plan === 'one_time' ? process.env.STRIPE_ONE_TIME_PRICE_ID : process.env.STRIPE_SUBSCRIPTION_PRICE_ID;
  if (!priceId) throw new Error(`Stripe ${input.plan === 'one_time' ? 'one-time' : 'subscription'} price is not configured.`);
  if (!/^price_[A-Za-z0-9]+$/.test(priceId)) throw new Error('Configured Stripe price ID is invalid.');
  const parsedOrigin = new URL(input.origin);
  if (parsedOrigin.origin !== input.origin || !['https:', 'http:'].includes(parsedOrigin.protocol)) throw new Error('Checkout origin is invalid.');
  if (parsedOrigin.protocol === 'http:' && !['localhost', '127.0.0.1'].includes(parsedOrigin.hostname)) throw new Error('Checkout requires a secure origin.');

  const metadata = {
    buyer_id: input.buyerId,
    user_id: input.buyerId,
    plan: input.plan,
    price_id: priceId,
    ...(input.email ? { customer_email: input.email } : {}),
  };
  const mode = input.plan === 'one_time' ? 'payment' : 'subscription';
  const session = await stripe().checkout.sessions.create({
    mode,
    payment_method_types: ['card'],
    line_items: [{ price: priceId, quantity: 1 }],
    ...(input.email ? { customer_email: input.email } : {}),
    client_reference_id: input.buyerId,
    metadata,
    ...(mode === 'payment' ? { customer_creation: 'always' as const, payment_intent_data: { metadata } } : { subscription_data: { metadata } }),
    allow_promotion_codes: true,
    success_url: `${input.origin}/?purchase=returned`,
    cancel_url: `${input.origin}/?purchase=cancelled`,
  });
  if (!session.url) throw new Error('Stripe did not return a Checkout URL.');
  return session.url;
}

function stripeId(value: string | { id: string } | null | undefined): string | null {
  return typeof value === 'string' ? value : value?.id ?? null;
}

async function storeCompletedCheckout(connection: PoolConnection, session: Stripe.Checkout.Session): Promise<void> {
  const buyerId = session.metadata?.buyer_id ?? session.client_reference_id;
  if (!buyerId || !/^[0-9a-f-]{36}$/i.test(buyerId)) return;
  const plan = session.metadata?.plan === 'subscription' ? 'subscription' : 'one_time';
  const status = session.payment_status === 'paid' || session.payment_status === 'no_payment_required' ? 'completed' : 'processing';
  const customerId = stripeId(session.customer);
  const subscriptionId = stripeId(session.subscription);
  const paymentIntentId = stripeId(session.payment_intent);
  await connection.execute(
    `INSERT INTO tiffany_orders (checkout_session_id, buyer_id, plan, stripe_customer_id, payment_intent_id, subscription_id, price_id, amount_total, currency, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE status = VALUES(status), payment_intent_id = VALUES(payment_intent_id), subscription_id = VALUES(subscription_id)`,
    [session.id, buyerId, plan, customerId, paymentIntentId, subscriptionId, session.metadata?.price_id ?? null, session.amount_total, session.currency, status],
  );
  if (status !== 'completed' || plan === 'subscription' && !subscriptionId) return;
  const grantId = plan === 'one_time' ? `one_time:${session.id}` : `subscription:${subscriptionId}`;
  await connection.execute(
    `INSERT INTO tiffany_entitlement_grants (grant_id, buyer_id, plan, is_active, stripe_customer_id, subscription_id, last_event_created)
     VALUES (?, ?, ?, 1, ?, ?, 0)
     ON DUPLICATE KEY UPDATE plan = VALUES(plan), is_active = 1, stripe_customer_id = VALUES(stripe_customer_id), subscription_id = VALUES(subscription_id)`,
    [grantId, buyerId, plan, customerId, subscriptionId],
  );
}

async function syncSubscription(connection: PoolConnection, subscription: Stripe.Subscription, active: boolean, eventCreated: number): Promise<void> {
  const buyerId = subscription.metadata?.buyer_id;
  if (!buyerId || !/^[0-9a-f-]{36}$/i.test(buyerId)) return;
  const customerId = stripeId(subscription.customer);
  await connection.execute(
    `INSERT INTO tiffany_entitlement_grants (grant_id, buyer_id, plan, is_active, stripe_customer_id, subscription_id, last_event_created)
     VALUES (?, ?, 'subscription', ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       is_active = IF(VALUES(last_event_created) >= last_event_created, VALUES(is_active), is_active),
       stripe_customer_id = IF(VALUES(last_event_created) >= last_event_created, VALUES(stripe_customer_id), stripe_customer_id),
       subscription_id = IF(VALUES(last_event_created) >= last_event_created, VALUES(subscription_id), subscription_id),
       last_event_created = GREATEST(last_event_created, VALUES(last_event_created))`,
    [`subscription:${subscription.id}`, buyerId, active ? 1 : 0, customerId, subscription.id, eventCreated],
  );
}

async function currentSubscriptionState(event: Stripe.Event): Promise<{ subscription: Stripe.Subscription; active: boolean } | null> {
  if (!event.type.startsWith('customer.subscription.')) return null;
  const eventSubscription = event.data.object as Stripe.Subscription;
  if (event.type === 'customer.subscription.deleted') return { subscription: eventSubscription, active: false };
  // Events can arrive out of order. Retrieve the current Stripe object before applying status;
  // if retrieval fails, let Stripe retry instead of storing potentially stale access state.
  const subscription = await stripe().subscriptions.retrieve(eventSubscription.id);
  return { subscription, active: subscription.status === 'active' || subscription.status === 'trialing' };
}

export async function processStripeEvent(event: Stripe.Event): Promise<'processed' | 'duplicate'> {
  const currentState = await currentSubscriptionState(event);
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const [insertResult] = await connection.execute('INSERT IGNORE INTO tiffany_stripe_events (event_id, event_type) VALUES (?, ?)', [event.id, event.type]);
    if ((insertResult as { affectedRows: number }).affectedRows === 0) {
      await connection.commit();
      return 'duplicate';
    }
    if (event.type === 'checkout.session.completed') {
      await storeCompletedCheckout(connection, event.data.object as Stripe.Checkout.Session);
    } else if (event.type === 'payment_intent.succeeded') {
      const intent = event.data.object as Stripe.PaymentIntent;
      await connection.execute('UPDATE tiffany_orders SET status = ?, payment_intent_id = ? WHERE payment_intent_id = ?', ['completed', intent.id, intent.id]);
    } else if (event.type === 'payment_intent.payment_failed') {
      const intent = event.data.object as Stripe.PaymentIntent;
      await connection.execute('UPDATE tiffany_orders SET status = ? WHERE payment_intent_id = ?', ['payment_failed', intent.id]);
    } else if (currentState) {
      await syncSubscription(connection, currentState.subscription, currentState.active, event.created);
    }
    await connection.commit();
    return 'processed';
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export function verifyStripeEvent(rawBody: Buffer, signature: string): Stripe.Event {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error('Stripe webhook signing secret is not configured.');
  return stripe().webhooks.constructEvent(rawBody, signature, secret);
}
