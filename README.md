# Mural Marketplace API

Backend service for a marketplace where customers pay with USDC on Polygon and the merchant automatically receives Colombian Pesos (COP) in their bank account.

Built with NestJS, PostgreSQL, and the Mural Pay sandbox API.

## Setup

### Prerequisites

- Node.js 18+
- pnpm
- PostgreSQL database

### Install and run locally

```bash
pnpm install
pnpm build

# Set DATABASE_URL (required)
export DATABASE_URL=postgresql://postgres:postgres@localhost:5432/marketplace

# Optional: set BASE_URL to enable Mural webhook auto-registration
export BASE_URL=https://your-deployed-url.com

node dist/main.js
```

Mural sandbox API keys are hardcoded in `src/config.ts` (per challenge FAQ #6). Override via `MURAL_API_KEY` and `MURAL_TRANSFER_KEY` env vars if needed.

### Deploy to Railway

The app is configured for Railway deployment:

1. Connect the GitHub repo to a Railway project
2. Add a PostgreSQL service and link it, set  `DATABASE_URL`
3. Set `BASE_URL` to the Railway-provided domain

### Run tests

```bash
pnpm test          # Unit tests
pnpm test:e2e      # E2E tests against deployed app (uses BASE_URL env var)
```

Swagger docs available at `/api-docs` once running.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/products` | List product catalog (5 seeded items, $0.50-$3.00) |
| `POST` | `/orders` | Create an order (checkout) |
| `GET` | `/orders/:id` | Get order status and payment instructions |
| `GET` | `/merchant/orders` | List all orders with payment status |
| `GET` | `/merchant/orders/:id` | Order detail with withdrawal info |
| `GET` | `/merchant/withdrawals` | COP withdrawals with live Mural status polling |
| `POST` | `/webhooks/mural` | Mural webhook receiver (ECDSA-verified) |

### Example usage

```bash
# List products
curl $BASE_URL/products

# Create an order (use a product ID from the catalog)
curl -X POST $BASE_URL/orders \
  -H 'Content-Type: application/json' \
  -d '{"customerEmail":"buyer@example.com","items":[{"productId":"<ID>","quantity":1}]}'

# Check order status
curl $BASE_URL/orders/<ORDER_ID>

# Merchant: view all orders
curl $BASE_URL/merchant/orders

# Merchant: view COP withdrawal status
curl $BASE_URL/merchant/withdrawals
```

## How it works

1. **Checkout**: Customer creates an order via `POST /orders`. The system computes the total and adds a random sub-cent USDC fraction (0.000001-0.000999) to create a unique payment amount.

2. **Payment**: Customer sends the exact USDC amount to the provided Polygon wallet address. Mural detects the deposit on-chain.

3. **Deposit matching**: Mural fires a webhook to `POST /webhooks/mural`. The handler verifies the ECDSA signature, then matches the deposited amount to a pending order using a fuzzy float comparison.

4. **Auto-conversion**: On match, the system creates and executes a Mural payout request to convert USDC to COP and transfer to the merchant's Colombian bank account.

5. **Status tracking**: `GET /merchant/withdrawals` polls the Mural API for real-time payout status on each request.

## Deposit matching: design and pitfalls

The core challenge is identifying which order a deposit belongs to when all customers send USDC to the same wallet address. This app uses **amount-based disambiguation**: each order gets a unique USDC amount by appending a random micro-fraction.

### How it works

When an order totals $1.50, the system generates an amount like `1.500347` USDC. The last three decimal places (000-999) are randomized, and the system checks that no other pending order already uses that exact amount. When a deposit of `1.500347` arrives, we look up `SELECT * FROM orders WHERE ABS(unique_amount_usdc - 1.500347) < 0.000001 AND status = 'pending_payment'`.

### Known pitfalls

- **Collision risk**: Two concurrent orders at the same base price have a ~1/999 chance of drawing the same micro-fraction. The app retries (up to 50 attempts) and a partial unique index (`idx_pending_unique_amount`) enforces uniqueness at the DB level, so the second insert fails rather than creating a duplicate. The retry loop handles this gracefully.

- **Exact amount required**: The customer must send the *exact* USDC amount. If an exchange deducts network fees from the transferred amount, the deposit won't match any order. A production system would need tolerance bands or an overpayment/refund flow.

- **No order expiration**: Pending orders never expire, so their unique amounts are permanently reserved. Over time this shrinks the available disambiguation space. Fix: expire orders after 30 minutes and free their slots.

- **Sub-cent dust loss**: The customer pays a micro-fraction above the real price (e.g., 1.500347 USDC for a $1.50 order), but Mural's payout API only accepts 2 decimal places, so the COP conversion is for 1.50 USDC. The remaining 0.000347 USDC stays as dust in the Mural account. Over thousands of orders this accumulates.

- **Single wallet for all customers**: All deposits go to the same wallet, making amount the only disambiguation signal. The production-grade alternative is **per-order deposit addresses**: use `POST /api/accounts` to create a dedicated Mural account (with its own wallet) for each order. The customer sends the exact dollar amount with no micro-fraction, the webhook identifies the order by which account was credited, and the full amount is converted to COP with no dust. The tradeoffs are added checkout latency (account creation + polling for ACTIVE status), a larger failure surface, and account sprawl requiring cleanup or reuse. But it eliminates collision risk, the exact-amount requirement, and dust loss in one architectural change.

- **Floating-point matching**: The database uses `DOUBLE PRECISION` for amounts and matches with an epsilon of `0.000001`. This works but is fragile -- `NUMERIC` column types with exact comparison would be safer.

- **Webhook redelivery**: If Mural re-delivers a webhook for the same deposit, a duplicate payout could occur. Mitigated by storing `deposit_tx_hash` on matched orders and skipping deposits with an already-seen transaction hash. Mural-level idempotency keys on payout requests would add a second layer of protection.

## Current status

**Verified working** (E2E tested against deployed app):
- Product catalog with 5 seeded items
- Order creation with unique USDC amount generation and collision avoidance
- Mural webhook endpoint with ECDSA signature verification
- Deposit-to-order matching by amount
- Automatic USDC-to-COP payout creation and execution on payment receipt
- Merchant dashboard: order list, order detail with withdrawal info, withdrawal status with live Mural polling
- Bootstrap service: auto-discovers Mural account and registers webhook on startup
- Swagger/OpenAPI at `/api-docs`
- PostgreSQL persistence (Railway-hosted)
- Deployed at https://mural-backend-challenge-production.up.railway.app

## Future work

- **Per-order deposit addresses** to eliminate amount-based matching entirely
- **Order expiration** (e.g., 30 min TTL) to free disambiguation slots
- **Payout retry queue** with exponential backoff instead of fire-and-forget
- **Idempotency keys** on Mural payout requests as a second layer against duplicate conversions
- **Authentication** on merchant endpoints (API key or JWT)
- **Rate limiting** on public endpoints
- **Strict webhook verification** (reject unsigned webhooks in production)
- **Database migrations** instead of `CREATE TABLE IF NOT EXISTS`
- **NUMERIC column types** for monetary amounts instead of `DOUBLE PRECISION`
- **Background status sync** for withdrawal polling instead of synchronous per-request calls
- **Monitoring/alerting** for failed payouts, unmatched deposits, webhook failures

