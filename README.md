# Mural Marketplace API

Backend service for a marketplace where customers pay with USDC on Polygon and the merchant automatically receives Colombian Pesos (COP) in their bank account.

Built with NestJS, PostgreSQL, and the Mural Pay sandbox API.

## Setup

### Prerequisites

- Node.js 18+
- pnpm
- PostgreSQL database

### Install and run

```bash
pnpm install
pnpm build

# Set DATABASE_URL (required)
export DATABASE_URL=postgresql://postgres:postgres@localhost:5432/marketplace

# Optional: set BASE_URL to enable Mural webhook auto-registration
export BASE_URL=https://your-deployed-url.com

node dist/main.js
```

Mural sandbox API keys are hardcoded in `src/config.ts` (per challenge FAQ #6). Environment variable overrides are supported via `MURAL_API_KEY` and `MURAL_TRANSFER_KEY`.

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

1. **Checkout**: Customer creates an order via `POST /orders`. The system computes the total and adds a random sub-cent USDC fraction (0.000001-0.000999) to create a unique payment amount. This unique amount identifies the payment.

2. **Payment**: Customer sends the exact USDC amount to the provided Polygon wallet address (outside the app). Mural fires a webhook when the deposit arrives.

3. **Deposit matching**: The webhook handler (`POST /webhooks/mural`) verifies the ECDSA signature, then matches the deposited amount to a pending order.

4. **Auto-conversion**: On match, the system automatically creates and executes a Mural payout request to convert USDC to COP and transfer to the merchant's Colombian bank account.

5. **Status tracking**: `GET /merchant/withdrawals` polls the Mural API for real-time payout status on each request.

## Deposit matching pitfalls

- **Collision risk**: Two concurrent orders at the same price have a ~1/999 chance of getting the same unique amount. Mitigated by collision checking at order creation, but a race condition window exists between check and insert.
- **Exact amount required**: Partial or over-payments won't match. If an exchange deducts fees from the transfer amount, the deposit won't be recognized.
- **No expiration**: Pending orders never expire. Stale orders occupy disambiguation slots indefinitely.
- **Single deposit wallet**: All customers send to the same wallet. Amount-based matching is the sole disambiguation mechanism.

## Current status

**Working:**
- Product catalog with 5 seeded items
- Order creation with unique USDC amount generation and collision avoidance
- Mural webhook endpoint with ECDSA signature verification
- Deposit-to-order matching by amount
- Automatic USDC-to-COP payout creation and execution on payment receipt
- Merchant order list, order detail (with withdrawal info), and withdrawal status endpoints
- Live payout status polling from Mural API on withdrawal queries
- Bootstrap service: auto-discovers or creates a Mural API-enabled account, registers and activates webhook on startup
- Swagger/OpenAPI at `/api-docs`
- PostgreSQL persistence (Railway-hosted)

**Needs live verification:**
- Full end-to-end flow with testnet USDC transfer triggering webhook, matching, and payout (depends on deployed URL being registered with Mural and webhook delivery working in sandbox)

## Future work

- **Per-order deposit addresses** to eliminate amount-based matching entirely
- **Order expiration** (e.g., 30 min TTL) to free disambiguation slots
- **Payout retry queue** with exponential backoff instead of fire-and-forget
- **Idempotency keys** on payout requests to prevent duplicate conversions on webhook redelivery
- **Authentication** on merchant endpoints (API key or JWT)
- **Rate limiting** on public endpoints
- **Strict webhook verification** (reject unsigned webhooks in production instead of accepting them)
- **Database migrations** instead of `CREATE TABLE IF NOT EXISTS`
- **Monitoring/alerting** for failed payouts, unmatched deposits, webhook failures
- **Multi-currency** merchant withdrawals beyond COP
