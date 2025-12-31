import { Hono } from 'hono';
import Stripe from 'stripe';
import { getDb } from '../db';
import { authMiddleware, adminOnly } from '../middleware/auth';
import { ApiError, uuid, now, type Env, type AuthContext } from '../types';
import { validateDiscount, calculateDiscount, type Discount } from './discounts';

// ============================================================
// ORDER ROUTES
// ============================================================

const ordersRoutes = new Hono<{
  Bindings: Env;
  Variables: { auth: AuthContext };
}>();

ordersRoutes.use('*', authMiddleware, adminOnly);

// GET /v1/orders
ordersRoutes.get('/', async (c) => {
  const { store } = c.get('auth');
  const db = getDb(c.env);

  const orderList = await db.query<any>(
    `SELECT * FROM orders WHERE store_id = ? ORDER BY created_at DESC`,
    [store.id]
  );

  const items = await Promise.all(
    orderList.map(async (order) => {
      const orderItems = await db.query<any>(
        `SELECT * FROM order_items WHERE order_id = ?`,
        [order.id]
      );
      return formatOrder(order, orderItems);
    })
  );

  return c.json({ items });
});

// GET /v1/orders/:orderId
ordersRoutes.get('/:orderId', async (c) => {
  const orderId = c.req.param('orderId');
  const { store } = c.get('auth');
  const db = getDb(c.env);

  const [order] = await db.query<any>(
    `SELECT * FROM orders WHERE id = ? AND store_id = ?`,
    [orderId, store.id]
  );
  if (!order) throw ApiError.notFound('Order not found');

  const orderItems = await db.query<any>(`SELECT * FROM order_items WHERE order_id = ?`, [order.id]);

  return c.json(formatOrder(order, orderItems));
});

// POST /v1/orders/:orderId/refund
ordersRoutes.post('/:orderId/refund', async (c) => {
  const orderId = c.req.param('orderId');
  const body = await c.req.json().catch(() => ({}));
  const amountCents = body?.amount_cents;

  const { store } = c.get('auth');
  if (!store.stripe_secret_key) throw ApiError.invalidRequest('Stripe not connected');

  const db = getDb(c.env);

  const [order] = await db.query<any>(
    `SELECT * FROM orders WHERE id = ? AND store_id = ?`,
    [orderId, store.id]
  );
  if (!order) throw ApiError.notFound('Order not found');
  if (order.status === 'refunded') throw ApiError.conflict('Order already refunded');
  if (!order.stripe_payment_intent_id) {
    throw ApiError.invalidRequest('Cannot refund test orders (no Stripe payment)');
  }

  const stripe = new Stripe(store.stripe_secret_key);

  try {
    const refund = await stripe.refunds.create({
      payment_intent: order.stripe_payment_intent_id,
      amount: amountCents,
    });

    await db.run(
      `INSERT INTO refunds (id, order_id, stripe_refund_id, amount_cents, status) VALUES (?, ?, ?, ?, ?)`,
      [uuid(), order.id, refund.id, refund.amount, refund.status ?? 'succeeded']
    );

    if (!amountCents || amountCents >= order.total_cents) {
      await db.run(`UPDATE orders SET status = 'refunded' WHERE id = ?`, [orderId]);
    }

    return c.json({ stripe_refund_id: refund.id, status: refund.status });
  } catch (e: any) {
    throw ApiError.stripeError(e.message || 'Refund failed');
  }
});

// POST /v1/orders/test - Create a test order (skips Stripe, for local testing)
ordersRoutes.post('/test', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { customer_email, items, discount_code } = body;

  if (!customer_email) throw ApiError.invalidRequest('customer_email is required');
  if (!Array.isArray(items) || items.length === 0) {
    throw ApiError.invalidRequest('items array is required');
  }

  const { store } = c.get('auth');
  const db = getDb(c.env);

  // Validate items and calculate totals
  let subtotal = 0;
  const orderItems = [];

  for (const { sku, qty } of items) {
    if (!sku || !qty || qty < 1) {
      throw ApiError.invalidRequest('Each item needs sku and qty > 0');
    }

    const [variant] = await db.query<any>(
      `SELECT * FROM variants WHERE store_id = ? AND sku = ?`,
      [store.id, sku]
    );
    if (!variant) throw ApiError.notFound(`SKU not found: ${sku}`);

    // Check inventory
    const [inv] = await db.query<any>(
      `SELECT * FROM inventory WHERE store_id = ? AND sku = ?`,
      [store.id, sku]
    );
    const available = (inv?.on_hand ?? 0) - (inv?.reserved ?? 0);
    if (available < qty) throw ApiError.insufficientInventory(sku);

    subtotal += variant.price_cents * qty;
    orderItems.push({
      sku,
      title: variant.title,
      qty,
      unit_price_cents: variant.price_cents,
    });
  }

  // Handle discount if provided
  let discountId = null;
  let discountCode = null;
  let discountAmountCents = 0;
  let discount: Discount | null = null;

  if (discount_code) {
    const normalizedCode = discount_code.toUpperCase().trim();
    const [discountRow] = await db.query<any>(
      `SELECT * FROM discounts WHERE code = ? AND store_id = ?`,
      [normalizedCode, store.id]
    );
    
    if (discountRow) {
      await validateDiscount(db, discountRow as Discount, subtotal, customer_email);
      discountAmountCents = calculateDiscount(discountRow as Discount, subtotal);
      discountId = discountRow.id;
      discountCode = discountRow.code;
      discount = discountRow as Discount;
    } else {
      throw ApiError.notFound('Discount code not found');
    }
  }

  const totalCents = subtotal - discountAmountCents;

  // Generate order number (consistent 4-digit padding with webhook)
  const timestamp = now();
  const orderCount = await db.query<any>(
    `SELECT COUNT(*) as count FROM orders WHERE store_id = ?`,
    [store.id]
  );
  const orderNumber = `ORD-${String((orderCount[0]?.count || 0) + 1).padStart(4, '0')}`;

  const orderId = uuid();

  // Create order
  await db.run(
    `INSERT INTO orders (id, store_id, number, status, customer_email, subtotal_cents, tax_cents, shipping_cents, total_cents, discount_code, discount_id, discount_amount_cents, created_at)
     VALUES (?, ?, ?, 'paid', ?, ?, 0, 0, ?, ?, ?, ?, ?)`,
    [orderId, store.id, orderNumber, customer_email, subtotal, totalCents, discountCode, discountId, discountAmountCents, timestamp]
  );

  // Create order items and deduct inventory
  for (const item of orderItems) {
    await db.run(
      `INSERT INTO order_items (id, order_id, sku, title, qty, unit_price_cents) VALUES (?, ?, ?, ?, ?, ?)`,
      [uuid(), orderId, item.sku, item.title, item.qty, item.unit_price_cents]
    );

    // Deduct from on_hand (not reserved since this bypasses checkout)
    await db.run(
      `UPDATE inventory SET on_hand = on_hand - ?, updated_at = ? WHERE store_id = ? AND sku = ?`,
      [item.qty, timestamp, store.id, item.sku]
    );
  }

  // Track discount usage if discount was applied
  if (discount && discountAmountCents > 0) {
    // Increment usage count
    await db.run(
      `UPDATE discounts 
       SET usage_count = usage_count + 1, updated_at = ? 
       WHERE id = ? 
         AND (usage_limit IS NULL OR usage_count < usage_limit)`,
      [timestamp, discountId]
    );

    // Record usage for per-customer tracking
    await db.run(
      `INSERT INTO discount_usage (id, discount_id, order_id, customer_email, discount_amount_cents)
       VALUES (?, ?, ?, ?, ?)`,
      [uuid(), discountId, orderId, customer_email.toLowerCase(), discountAmountCents]
    );
  }

  const [order] = await db.query<any>(`SELECT * FROM orders WHERE id = ?`, [orderId]);
  return c.json(formatOrder(order, orderItems));
});

function formatOrder(order: any, items: any[]) {
  return {
    id: order.id,
    number: order.number,
    status: order.status,
    customer_email: order.customer_email,
    ship_to: order.ship_to ? JSON.parse(order.ship_to) : null,
    amounts: {
      subtotal_cents: order.subtotal_cents,
      discount_cents: order.discount_amount_cents || 0,
      tax_cents: order.tax_cents,
      shipping_cents: order.shipping_cents,
      total_cents: order.total_cents,
      currency: order.currency,
    },
    discount: order.discount_code
      ? {
          code: order.discount_code,
          amount_cents: order.discount_amount_cents || 0,
        }
      : null,
    stripe: {
      checkout_session_id: order.stripe_checkout_session_id,
      payment_intent_id: order.stripe_payment_intent_id,
    },
    items: items.map((i) => ({
      sku: i.sku,
      title: i.title,
      qty: i.qty,
      unit_price_cents: i.unit_price_cents,
    })),
    created_at: order.created_at,
  };
}

export { ordersRoutes as orders };
