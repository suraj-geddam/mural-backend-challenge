/**
 * E2E flow tests against the deployed Railway app.
 *
 * Tests the three workflows from the challenge spec:
 *   1. Customer: Product Checkout & Payment Collection
 *   2. Merchant: Payment Receipt & Verification
 *   3. Merchant: Automatic Fund Conversion & Withdrawal
 *
 * Run: pnpm test:e2e
 * Override target: BASE_URL=https://... pnpm test:e2e
 */

const BASE =
  process.env.BASE_URL ||
  'https://mural-backend-challenge-production.up.railway.app';

describe('Flow 1: Customer Product Checkout & Payment Collection', () => {
  let products: any[];
  let orderResponse: any;

  it('customer browses the product catalog', async () => {
    const res = await fetch(`${BASE}/products`);
    expect(res.status).toBe(200);

    products = await res.json();
    expect(products.length).toBeGreaterThanOrEqual(5);

    // Every product has the fields needed to display a catalog
    for (const p of products) {
      expect(p).toHaveProperty('id');
      expect(p).toHaveProperty('name');
      expect(p).toHaveProperty('description');
      expect(typeof p.price_usd).toBe('number');
      expect(p.price_usd).toBeGreaterThan(0);
    }
  });

  it('customer adds items to cart and checks out', async () => {
    // Pick two different products to simulate a multi-item cart
    const [cheap, expensive] = [products[0], products[products.length - 1]];

    const res = await fetch(`${BASE}/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerEmail: 'e2e-checkout@test.com',
        items: [
          { productId: cheap.id, quantity: 2 },
          { productId: expensive.id, quantity: 1 },
        ],
      }),
    });
    expect(res.status).toBe(201);

    orderResponse = await res.json();

    // The checkout response gives the customer everything they need to pay
    expect(orderResponse.status).toBe('pending_payment');
    expect(orderResponse.depositAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(orderResponse.amountUsdc).toBeGreaterThan(0);
    expect(orderResponse.message).toContain('Send exactly');
    expect(orderResponse.message).toContain('USDC');

    // Total should reflect the cart: 2x cheap + 1x expensive
    const expectedTotal =
      Math.round((cheap.price_usd * 2 + expensive.price_usd) * 100) / 100;
    expect(orderResponse.totalUsd).toBe(expectedTotal);

    // The unique USDC amount has sub-cent precision for deposit matching
    const microFraction = orderResponse.amountUsdc - expectedTotal;
    expect(microFraction).toBeGreaterThan(0);
    expect(microFraction).toBeLessThan(0.001);
  });

  it('customer can check their order status while waiting to pay', async () => {
    const res = await fetch(`${BASE}/orders/${orderResponse.orderId}`);
    expect(res.status).toBe(200);

    const order = await res.json();
    expect(order.id).toBe(orderResponse.orderId);
    expect(order.status).toBe('pending_payment');
    expect(order.items.length).toBe(2);
    expect(order.customer_email).toBe('e2e-checkout@test.com');
  });

  it('rejects checkout with empty cart', async () => {
    const res = await fetch(`${BASE}/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customerEmail: 'x@y.com', items: [] }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects checkout with invalid product', async () => {
    const res = await fetch(`${BASE}/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerEmail: 'x@y.com',
        items: [{ productId: 'does-not-exist', quantity: 1 }],
      }),
    });
    expect(res.status).toBe(400);
  });
});

describe('Flow 2: Merchant Payment Receipt & Verification', () => {
  let orderId: string;
  let uniqueAmountUsdc: number;

  it('setup: create an order to receive payment for', async () => {
    // First get a product
    const prodRes = await fetch(`${BASE}/products`);
    const products = await prodRes.json();

    const res = await fetch(`${BASE}/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerEmail: 'e2e-payment@test.com',
        items: [{ productId: products[0].id, quantity: 1 }],
      }),
    });
    const order = await res.json();
    orderId = order.orderId;
    uniqueAmountUsdc = order.amountUsdc;
  });

  it('simulates a USDC deposit via webhook and detects payment', async () => {
    // Simulate Mural firing an account_credited webhook.
    // No signature headers → skips ECDSA verification (development mode).
    const webhookPayload = {
      type: 'account_credited',
      tokenAmount: { tokenAmount: uniqueAmountUsdc },
      transactionDetails: { transactionHash: `0xe2e-test-${Date.now()}` },
    };

    const res = await fetch(`${BASE}/webhooks/mural`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(webhookPayload),
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.received).toBe(true);
    expect(body.matched).toBe(true);
    expect(body.orderId).toBe(orderId);
  });

  it('merchant sees the order is no longer pending_payment', async () => {
    // Give the async COP conversion a moment to update status
    await new Promise((r) => setTimeout(r, 1000));

    const res = await fetch(`${BASE}/merchant/orders/${orderId}`);
    expect(res.status).toBe(200);

    const detail = await res.json();
    expect(detail.id).toBe(orderId);
    // Status should have progressed past pending_payment
    // Could be 'paid', 'withdrawal_initiated', or further depending on payout success
    expect(detail.status).not.toBe('pending_payment');
  });

  it('merchant can see payment confirmation in the order list', async () => {
    const res = await fetch(`${BASE}/merchant/orders`);
    expect(res.status).toBe(200);

    const orders = await res.json();
    const matched = orders.find((o: any) => o.id === orderId);
    expect(matched).toBeTruthy();
    expect(matched.status).not.toBe('pending_payment');
  });
});

describe('Flow 3: Merchant Automatic Fund Conversion & Withdrawal', () => {
  it('merchant can view all COP withdrawals with status', async () => {
    const res = await fetch(`${BASE}/merchant/withdrawals`);
    expect(res.status).toBe(200);

    const withdrawals = await res.json();
    expect(Array.isArray(withdrawals)).toBe(true);

    // Each withdrawal record has the expected shape
    for (const w of withdrawals) {
      expect(w).toHaveProperty('id');
      expect(w).toHaveProperty('order_id');
      expect(w).toHaveProperty('amount_usdc');
      expect(w).toHaveProperty('mural_payout_request_id');
      expect(w).toHaveProperty('status');
      // Status should be one of the known states
      expect(['pending', 'executing', 'completed', 'failed']).toContain(
        w.status,
      );
    }
  });

  it('merchant order detail includes withdrawal info when payout was attempted', async () => {
    // Find an order that has progressed past payment
    const ordersRes = await fetch(`${BASE}/merchant/orders`);
    const orders = await ordersRes.json();
    const paidOrder = orders.find(
      (o: any) => o.status !== 'pending_payment',
    );

    if (!paidOrder) {
      // No paid orders in the system -- skip gracefully
      console.log('No paid orders found, skipping withdrawal detail check');
      return;
    }

    const res = await fetch(`${BASE}/merchant/orders/${paidOrder.id}`);
    expect(res.status).toBe(200);

    const detail = await res.json();
    // The withdrawal field is present (may be null if payout creation failed)
    expect(detail).toHaveProperty('withdrawal');

    if (detail.withdrawal) {
      expect(detail.withdrawal).toHaveProperty('mural_payout_request_id');
      expect(detail.withdrawal).toHaveProperty('amount_usdc');
      expect(detail.withdrawal).toHaveProperty('status');
    }
  });
});

describe('Infrastructure', () => {
  it('Swagger docs are accessible', async () => {
    const res = await fetch(`${BASE}/api-docs`);
    expect([200, 301, 302]).toContain(res.status);
  });
});
