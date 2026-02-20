import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';
import { v4 as uuid } from 'uuid';

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private pool: Pool;

  async onModuleInit() {
    this.pool = new Pool({
      connectionString:
        process.env.DATABASE_URL ||
        'postgresql://postgres:postgres@localhost:5432/marketplace',
    });
    await this.initSchema();
    await this.seedProducts();
  }

  async onModuleDestroy() {
    await this.pool.end();
  }

  private async initSchema() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS products (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        price_usd DOUBLE PRECISION NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        customer_email TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending_payment',
        total_usd DOUBLE PRECISION NOT NULL,
        unique_amount_usdc DOUBLE PRECISION NOT NULL,
        mural_deposit_address TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS order_items (
        id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL REFERENCES orders(id),
        product_id TEXT NOT NULL REFERENCES products(id),
        quantity INTEGER NOT NULL,
        unit_price_usd DOUBLE PRECISION NOT NULL
      );
      CREATE TABLE IF NOT EXISTS withdrawals (
        id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL REFERENCES orders(id),
        mural_payout_request_id TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        amount_usdc DOUBLE PRECISION,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      -- Prevent duplicate deposit processing on webhook redelivery
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS deposit_tx_hash TEXT;

      -- Prevent two concurrent pending orders from getting the same unique amount
      CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_unique_amount
        ON orders (unique_amount_usdc) WHERE status = 'pending_payment';
    `);
  }

  private async seedProducts() {
    const { rows } = await this.pool.query(
      'SELECT COUNT(*)::int as c FROM products',
    );
    if (rows[0].c > 0) return;

    const products = [
      [uuid(), 'Sticker Pack', 'Cool marketplace stickers', 0.5],
      [uuid(), 'Digital Badge', 'Exclusive digital badge', 1.0],
      [uuid(), 'Premium Theme', 'Custom app theme', 1.5],
      [uuid(), 'Gift Card $2', 'Marketplace gift card', 2.0],
      [uuid(), 'Pro Upgrade', 'One-month pro access', 3.0],
    ];

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const [id, name, desc, price] of products) {
        await client.query(
          'INSERT INTO products (id, name, description, price_usd) VALUES ($1, $2, $3, $4)',
          [id, name, desc, price],
        );
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  // --- Query helpers ---

  async getAllProducts() {
    const { rows } = await this.pool.query(
      'SELECT * FROM products ORDER BY price_usd',
    );
    return rows;
  }

  async getProduct(id: string) {
    const { rows } = await this.pool.query(
      'SELECT * FROM products WHERE id = $1',
      [id],
    );
    return rows[0] || null;
  }

  async createOrder(order: {
    id: string;
    customerEmail: string;
    totalUsd: number;
    uniqueAmountUsdc: number;
    depositAddress: string;
    items: { productId: string; quantity: number; unitPrice: number }[];
  }) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO orders (id, customer_email, total_usd, unique_amount_usdc, mural_deposit_address)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          order.id,
          order.customerEmail,
          order.totalUsd,
          order.uniqueAmountUsdc,
          order.depositAddress,
        ],
      );
      for (const item of order.items) {
        await client.query(
          'INSERT INTO order_items (id, order_id, product_id, quantity, unit_price_usd) VALUES ($1, $2, $3, $4, $5)',
          [uuid(), order.id, item.productId, item.quantity, item.unitPrice],
        );
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    return this.getOrder(order.id);
  }

  async getOrder(id: string) {
    const { rows: orderRows } = await this.pool.query(
      'SELECT * FROM orders WHERE id = $1',
      [id],
    );
    if (!orderRows[0]) return null;
    const order = orderRows[0];
    const { rows: items } = await this.pool.query(
      'SELECT * FROM order_items WHERE order_id = $1',
      [id],
    );
    return { ...order, items };
  }

  async getAllOrders() {
    const { rows } = await this.pool.query(
      'SELECT * FROM orders ORDER BY created_at DESC',
    );
    return rows;
  }

  async findPendingOrderByAmount(amount: number) {
    const { rows } = await this.pool.query(
      `SELECT * FROM orders
       WHERE status = 'pending_payment'
       AND ABS(unique_amount_usdc - $1) < 0.000001
       ORDER BY created_at ASC LIMIT 1`,
      [amount],
    );
    return rows[0] || null;
  }

  async isPendingAmountTaken(amount: number): Promise<boolean> {
    const { rows } = await this.pool.query(
      `SELECT 1 FROM orders
       WHERE status = 'pending_payment'
       AND ABS(unique_amount_usdc - $1) < 0.000001`,
      [amount],
    );
    return rows.length > 0;
  }

  async isDepositTxProcessed(txHash: string): Promise<boolean> {
    const { rows } = await this.pool.query(
      `SELECT 1 FROM orders WHERE deposit_tx_hash = $1`,
      [txHash],
    );
    return rows.length > 0;
  }

  async updateOrderStatus(id: string, status: string) {
    await this.pool.query(
      `UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2`,
      [status, id],
    );
  }

  async setOrderDepositTx(id: string, txHash: string) {
    await this.pool.query(
      `UPDATE orders SET deposit_tx_hash = $1, updated_at = NOW() WHERE id = $2`,
      [txHash, id],
    );
  }

  async createWithdrawal(w: {
    id: string;
    orderId: string;
    amountUsdc: number;
    muralPayoutRequestId: string;
  }) {
    await this.pool.query(
      `INSERT INTO withdrawals (id, order_id, amount_usdc, mural_payout_request_id, status)
       VALUES ($1, $2, $3, $4, 'executing')`,
      [w.id, w.orderId, w.amountUsdc, w.muralPayoutRequestId],
    );
  }

  async getWithdrawalByOrderId(orderId: string) {
    const { rows } = await this.pool.query(
      'SELECT * FROM withdrawals WHERE order_id = $1',
      [orderId],
    );
    return rows[0] || null;
  }

  async getAllWithdrawals() {
    const { rows } = await this.pool.query(
      'SELECT * FROM withdrawals ORDER BY created_at DESC',
    );
    return rows;
  }

  async updateWithdrawalStatus(id: string, status: string) {
    await this.pool.query(
      `UPDATE withdrawals SET status = $1, updated_at = NOW() WHERE id = $2`,
      [status, id],
    );
  }
}
