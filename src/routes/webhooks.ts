import { Hono } from 'hono';
import Stripe from 'stripe';
import { getDb } from '../db';
import { ApiError, uuid, now, type Env } from '../types';
import { dispatchWebhooks } from '../lib/webhooks';

// ============================================================
// WEBHOOK ROUTES
// ============================================================

export const webhooks = new Hono<{ Bindings: Env }>();

// POST /v1/webhooks/stripe
webhooks.post('/stripe', async (c) => {
  const signature = c.req.header('stripe-signature');
  const body = await c.req.text();

  if (!signature) throw ApiError.invalidRequest('Missing stripe-signature header');

  let rawEvent: any;
  try {
    rawEvent = JSON.parse(body);
  } catch {
    throw ApiError.invalidRequest('Invalid JSON');
  }

  const storeId = rawEvent.data?.object?.metadata?.store_id;
  if (!storeId) throw ApiError.invalidRequest('Missing store_id in metadata');

  const db = getDb(c.env);

  const [store] = await db.query<any>(`SELECT * FROM stores WHERE id = ?`, [storeId]);
  if (!store?.stripe_webhook_secret) {
    throw ApiError.invalidRequest('Store not found or webhook secret missing');
  }

  // Verify signature
  const stripe = new Stripe(store.stripe_secret_key);
  let event: Stripe.Event;

  try {
    event = await stripe.webhooks.constructEventAsync(body, signature, store.stripe_webhook_secret);
  } catch (e: any) {
    throw new ApiError('webhook_signature_invalid', 400, e.message);
  }

  // Dedupe
  const [existing] = await db.query<any>(`SELECT id FROM events WHERE stripe_event_id = ?`, [event.id]);
  if (existing) return c.json({ ok: true });

  // Handle checkout.session.completed
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const cartId = session.metadata?.cart_id;

    if (cartId) {
      const [cart] = await db.query<any>(`SELECT * FROM carts WHERE id = ?`, [cartId]);
      if (cart) {
        const items = await db.query<any>(`SELECT * FROM cart_items WHERE cart_id = ?`, [cartId]);

        // Handle discount
        let discountCode = null;
        let discountId = null;
        let discountAmountCents = 0;
        let shouldTrackUsage = false;
        const shippingCents = session.total_details?.amount_shipping ?? 0;

        if (session.metadata?.discount_id) {
          const [discount] = await db.query<any>(
            `SELECT * FROM discounts WHERE id = ? AND store_id = ?`,
            [session.metadata.discount_id, store.id]
          );

          if (discount) {
            discountCode = discount.code;
            discountId = discount.id;
            discountAmountCents = cart.discount_amount_cents || 0;

            // Validate discount is still active/valid for usage tracking
            // Even if invalid, we record the discount for accounting accuracy
            // (customer already paid discounted amount), but skip usage counting
            const currentTime = now();
            const isValid =
              discount.status === 'active' &&
              (!discount.starts_at || currentTime >= discount.starts_at) &&
              (!discount.expires_at || currentTime <= discount.expires_at);

            shouldTrackUsage = isValid && discountAmountCents > 0;

            // Atomically increment usage count only if within limits
            // If the limit was reached between checkout and webhook, we do NOT
            // force-increment beyond the limit - this maintains data integrity.
            // The discount was applied at checkout when it was still valid.
            if (shouldTrackUsage) {
              await db.run(
                `UPDATE discounts 
                 SET usage_count = usage_count + 1, updated_at = ? 
                 WHERE id = ? 
                   AND (usage_limit IS NULL OR usage_count < usage_limit)`,
                [currentTime, discount.id]
              );
            }
          }
        }

        // Calculate subtotal from cart items (before discounts)
        // session.amount_subtotal includes discounts as negative line items, so we calculate from original items
        const subtotalCents = items.reduce((sum, item) => sum + item.unit_price_cents * item.qty, 0);

        // Generate order number
        const [countResult] = await db.query<any>(
          `SELECT COUNT(*) as count FROM orders WHERE store_id = ?`,
          [store.id]
        );
        const orderNumber = `ORD-${String(Number(countResult.count) + 1).padStart(4, '0')}`;

        // Create order
        const orderId = uuid();
        await db.run(
          `INSERT INTO orders (id, store_id, number, status, customer_email, ship_to,
           subtotal_cents, tax_cents, shipping_cents, total_cents, currency,
           discount_code, discount_id, discount_amount_cents,
           stripe_checkout_session_id, stripe_payment_intent_id)
           VALUES (?, ?, ?, 'paid', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            orderId, store.id, orderNumber, cart.customer_email,
            session.shipping_details?.address ? JSON.stringify(session.shipping_details.address) : null,
            subtotalCents, session.total_details?.amount_tax ?? 0,
            shippingCents, session.amount_total ?? 0, cart.currency,
            discountCode, discountId, discountAmountCents,
            session.id, session.payment_intent
          ]
        );

        // Track discount usage (only if discount is valid and provided value)
        // Store email in lowercase for consistent per-customer limit checks
        if (shouldTrackUsage && discountId) {
          await db.run(
            `INSERT INTO discount_usage (id, discount_id, order_id, customer_email, discount_amount_cents)
             VALUES (?, ?, ?, ?, ?)`,
            [uuid(), discountId, orderId, cart.customer_email.toLowerCase(), discountAmountCents]
          );
        }

        // Create order items & update inventory
        for (const item of items) {
          await db.run(
            `INSERT INTO order_items (id, order_id, sku, title, qty, unit_price_cents) VALUES (?, ?, ?, ?, ?, ?)`,
            [uuid(), orderId, item.sku, item.title, item.qty, item.unit_price_cents]
          );

          await db.run(
            `UPDATE inventory SET reserved = reserved - ?, on_hand = on_hand - ?, updated_at = ? WHERE store_id = ? AND sku = ?`,
            [item.qty, item.qty, now(), store.id, item.sku]
          );

          await db.run(
            `INSERT INTO inventory_logs (id, store_id, sku, delta, reason) VALUES (?, ?, ?, ?, 'sale')`,
            [uuid(), store.id, item.sku, -item.qty]
          );
        }

        // Dispatch order.created webhook
        const orderItems = await db.query<any>(`SELECT * FROM order_items WHERE order_id = ?`, [orderId]);
        await dispatchWebhooks(c.env, c.executionCtx, store.id, 'order.created', {
          order: {
            id: orderId,
            number: orderNumber,
            status: 'paid',
            customer_email: cart.customer_email,
            ship_to: session.shipping_details?.address || null,
            amounts: {
              subtotal_cents: session.amount_subtotal ?? 0,
              tax_cents: session.total_details?.amount_tax ?? 0,
              shipping_cents: session.total_details?.amount_shipping ?? 0,
              total_cents: session.amount_total ?? 0,
              currency: cart.currency,
            },
            items: orderItems.map((i: any) => ({
              sku: i.sku,
              title: i.title,
              qty: i.qty,
              unit_price_cents: i.unit_price_cents,
            })),
            stripe: {
              checkout_session_id: session.id,
              payment_intent_id: session.payment_intent,
            },
          },
        });
      }
    }
  }

  // Log event
  await db.run(
    `INSERT INTO events (id, store_id, stripe_event_id, type, payload) VALUES (?, ?, ?, ?, ?)`,
    [uuid(), store.id, event.id, event.type, JSON.stringify(event.data.object)]
  );

  return c.json({ ok: true });
});
