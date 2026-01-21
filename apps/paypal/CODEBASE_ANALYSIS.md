# PayPal App Codebase Analysis

This document provides a comprehensive analysis of the Saleor PayPal Payment App codebase.

## Overview

| Attribute | Value |
|-----------|-------|
| **App Name** | `saleor-app-payment-paypal` |
| **Version** | 1.0.0 |
| **Framework** | Next.js 15 (App Router + Pages Router) |
| **Language** | TypeScript (strict mode) |
| **Database** | PostgreSQL |
| **Saleor Version** | 3.21 |
| **Dev Port** | 3005 |

### Purpose

A Saleor Payment App that enables merchants to accept online payments through PayPal's payment processing platform. It handles:

- Payment transactions (capture/authorize)
- Refunds (full/partial)
- Multi-tenant merchant onboarding
- Apple Pay/Google Pay domain registration
- Partner fee collection

---

## Directory Structure

```
apps/paypal/
├── src/
│   ├── app/api/                    # Next.js App Router
│   │   ├── manifest/               # App manifest endpoint
│   │   ├── register/               # App registration
│   │   ├── trpc/[trpc]/            # tRPC API routes
│   │   └── webhooks/
│   │       ├── paypal/             # PayPal webhook handlers
│   │       └── saleor/             # Saleor webhook handlers
│   ├── lib/                        # Shared utilities
│   │   ├── logger.ts               # Logging factory
│   │   ├── database.ts             # PostgreSQL pool
│   │   ├── env.ts                  # Environment config
│   │   ├── errors.ts               # BaseError utilities
│   │   └── graphql-client.ts       # URQL client
│   ├── modules/                    # Domain modules
│   │   ├── app-config/             # Tenant configuration
│   │   ├── merchant-onboarding/    # Onboarding workflow
│   │   ├── paypal/                 # PayPal API clients
│   │   ├── saleor/                 # Saleor helpers
│   │   ├── transaction-result/     # Result types
│   │   ├── trpc/                   # tRPC router
│   │   ├── ui/                     # React components
│   │   └── wsm-admin/              # Global config
│   └── pages/                      # Next.js Pages Router (UI)
├── graphql/                        # GraphQL schemas & operations
├── generated/                      # Generated types
├── scripts/                        # Build/migration scripts
└── public/                         # Static assets
```

---

## Module Architecture

### 1. `paypal` Module

Core PayPal integration located at `src/modules/paypal/`.

#### Base Client (`paypal-client.ts`)

```typescript
class PayPalClient {
  // OAuth 2.0 authentication with token caching
  // PayPal-Auth-Assertion header for merchant context
  // PayPal-Partner-Attribution-Id header (BN code)
  // Request/Response logging with debug IDs
}
```

**Key Features:**
- Global OAuth token cache (`paypal-oauth-token-cache.ts`)
- Automatic token refresh
- Environment-aware base URLs (Sandbox/Live)
- Full request/response logging

#### Orders API (`paypal-orders-api.ts`)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `createOrder()` | `POST /v2/checkout/orders` | Create payment order |
| `captureOrder()` | `POST /v2/checkout/orders/{id}/capture` | Capture funds |
| `authorizeOrder()` | `POST /v2/checkout/orders/{id}/authorize` | Authorize payment |
| `getOrder()` | `GET /v2/checkout/orders/{id}` | Get order details |
| `patchOrder()` | `PATCH /v2/checkout/orders/{id}` | Update order |

**Order Creation Options:**
- Line items with SKU, description, category
- Amount breakdown (item_total, shipping, tax_total)
- Platform fees for partner fee collection
- Shipping address
- Payer information
- Experience context (brand_name, return_url, etc.)
- Payment source (PayPal, Card, Venmo with vault_id)

#### Refunds API (`paypal-refunds-api.ts`)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `refundCapture()` | `POST /v2/payments/captures/{id}/refund` | Process refund |

**Features:**
- Full and partial refunds
- Idempotency via `PayPal-Request-Id` header
- BN code for partner attribution

#### Partner Referrals API (`paypal-partner-referrals-api.ts`)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `createPartnerReferral()` | `POST /v2/customer/partner-referrals` | Start merchant onboarding |
| `getSellerStatus()` | `GET /v1/customer/partners/{id}/merchant-integrations/{id}` | Check merchant status |
| `getSellerStatusByTrackingId()` | `GET /v1/customer/partners/{id}/merchant-integrations?tracking_id=` | Status by tracking ID |
| `checkPaymentMethodReadiness()` | - | Analyze payment capabilities |
| `registerApplePayDomain()` | `POST /v1/customer/wallet-domains` | Register Apple Pay domain |
| `getApplePayDomains()` | `GET /v1/customer/wallet-domains` | List registered domains |
| `deleteApplePayDomain()` | `POST /v1/customer/unregister-wallet-domain` | Remove domain |

**Payment Method Readiness Checks:**
- PayPal Buttons: `PPCP_CUSTOM` subscribed
- Card Processing: `PPCP_CUSTOM` + `CUSTOM_CARD_PROCESSING` active
- Apple Pay: `PPCP_CUSTOM` + `APPLE_PAY` capability active
- Google Pay: `PPCP_CUSTOM` + `GOOGLE_PAY` capability active
- Vaulting: `ADVANCED_VAULTING` + `PAYPAL_WALLET_VAULTING_ADVANCED` active

#### Branded Types

| Type | File | Purpose |
|------|------|---------|
| `PayPalOrderId` | `paypal-order-id.ts` | Order identifier |
| `PayPalClientId` | `paypal-client-id.ts` | API client ID |
| `PayPalClientSecret` | `paypal-client-secret.ts` | API secret |
| `PayPalMerchantId` | `paypal-merchant-id.ts` | Merchant identifier |
| `PayPalRefundId` | `paypal-refund-id.ts` | Refund identifier |
| `PayPalEnv` | `paypal-env.ts` | Environment (SANDBOX/LIVE) |
| `PayPalPartnerReferralId` | `paypal-partner-referral-id.ts` | Referral identifier |

### 2. `wsm-admin` Module

Global PayPal configuration for WSM administrators.

**Database Table:** `wsm_global_paypal_config`

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `client_id` | VARCHAR | Partner PayPal Client ID |
| `client_secret` | VARCHAR | Partner PayPal Secret |
| `partner_merchant_id` | VARCHAR | Partner's PayPal Merchant ID |
| `partner_fee_percent` | DECIMAL | Fee percentage |
| `bn_code` | VARCHAR | Partner Attribution ID |
| `webhook_id` | VARCHAR | PayPal webhook ID |
| `webhook_url` | VARCHAR | Webhook endpoint URL |
| `environment` | VARCHAR | SANDBOX or LIVE |
| `is_active` | BOOLEAN | Active config flag |

**Repository:** `GlobalPayPalConfigRepository`
- `getActiveConfig()` - With in-memory caching
- `upsertConfig()` - Create/update with cache invalidation
- `testCredentials()` - Validate PayPal credentials
- `updateWebhookInfo()` - Update webhook settings

### 3. `merchant-onboarding` Module

Handles merchant onboarding state and workflow.

**Database Table:** `paypal_merchant_onboarding`

**Repository:** `MerchantOnboardingRepository`

**tRPC Handlers:**
- `createMerchantReferral` - Start onboarding flow
- `refreshMerchantStatus` - Update merchant status from PayPal
- `getMerchantStatus` - Get current status
- `listMerchants` - List all merchants
- `deleteMerchantOnboarding` - Remove merchant
- `updateMerchantId` - Update PayPal Merchant ID
- `registerApplePayDomain` - Register domain for Apple Pay
- `getApplePayDomains` - List registered domains
- `deleteApplePayDomain` - Remove domain registration

### 4. `app-config` Module

Per-tenant PayPal configuration and channel mappings.

**Components:**
- `PayPalConfig` domain entity
- `AppConfigRepo` - Configuration repository
- `PayPalTenantConfigRepository` - Tenant-specific config

**tRPC Handlers:**
- `getSaleorChannels` - List available channels
- `getPayPalConfigsList` - List all PayPal configs
- `getPayPalConfigsChannelsMapping` - Get channel-to-config mapping
- `newPayPalConfig` - Create new configuration
- `removePayPalConfig` - Delete configuration
- `updateMapping` - Update channel mapping
- `getTenantConfig` / `setTenantConfig` - Tenant settings

### 5. `transaction-result` Module

Standardized transaction result types.

| Type | File | Purpose |
|------|------|---------|
| `SuccessResult` | `success-result.ts` | Successful transaction |
| `FailureResult` | `failure-result.ts` | Failed transaction |
| `CancelResult` | `cancel-result.ts` | Cancelled transaction |
| `ActionRequiredResult` | `action-required-result.ts` | Needs customer action |

---

## Webhook Handlers

### Saleor Webhooks

Located at `src/app/api/webhooks/saleor/`:

| Webhook | Endpoint | Purpose |
|---------|----------|---------|
| `payment-gateway-initialize-session` | `/api/webhooks/saleor/payment-gateway-initialize-session` | Returns PayPal Client ID for SDK init |
| `transaction-initialize-session` | `/api/webhooks/saleor/transaction-initialize-session` | Creates PayPal order |
| `transaction-process-session` | `/api/webhooks/saleor/transaction-process-session` | Processes approved payment |
| `transaction-charge-requested` | `/api/webhooks/saleor/transaction-charge-requested` | Captures funds |
| `transaction-refund-requested` | `/api/webhooks/saleor/transaction-refund-requested` | Processes refunds |
| `transaction-cancelation-requested` | `/api/webhooks/saleor/transaction-cancelation-requested` | Validates cancellation |

**Webhook Handler Structure:**
```
webhook-name/
├── route.ts              # Next.js route handler (POST export)
├── use-case.ts           # Business logic (UseCase class)
├── use-case-response.ts  # Response types
└── webhook-definition.ts # Webhook metadata
```

**Middleware Stack:**
```typescript
export const POST = compose(
  withLoggerContext,
  appContextContainer.wrapRequest,
  withSpanAttributesAppRouter,
)(handler);
```

### PayPal Webhooks

Located at `src/app/api/webhooks/paypal/`:

| Webhook | Purpose |
|---------|---------|
| `platform-events` | PayPal platform event notifications |
| `order-update-callback` | Order status updates |

---

## tRPC Router Structure

Main router at `src/modules/trpc/trpc-router.ts`:

```typescript
export const trpcRouter = router({
  appConfig: appConfigRouter,
  merchantOnboarding: merchantOnboardingRouter,
  wsmAdmin: wsmAdminRouter,
});
```

**Endpoint:** `/api/trpc/[trpc]`

---

## Key Design Patterns

### 1. Result-Based Error Handling

Using `neverthrow` library:

```typescript
const result = await paypalOrdersApi.createOrder(...);

if (result.isErr()) {
  return err(new ErrorResponse(result.error));
}

const order = result.value;
```

### 2. Branded Types with Zod

```typescript
const paypalOrderIdSchema = z.string().brand("PayPalOrderId");
export type PayPalOrderId = z.infer<typeof paypalOrderIdSchema>;
export const createPayPalOrderId = (raw: string) => paypalOrderIdSchema.parse(raw);
```

### 3. Use Case Pattern

```typescript
class TransactionRefundRequestedUseCase {
  constructor(deps: {
    paypalConfigRepo: PayPalConfigRepo;
    paypalOrdersApiFactory: IPayPalOrdersApiFactory;
    paypalRefundsApiFactory: IPayPalRefundsApiFactory;
  }) {}

  async execute(args: { authData, event }): Promise<UseCaseExecuteResult> {
    // Business logic
  }
}
```

### 4. Factory Pattern

```typescript
class PayPalOrdersApiFactory implements IPayPalOrdersApiFactory {
  create(config: ApiConfig): PayPalOrdersApi {
    return PayPalOrdersApi.create(config);
  }
}
```

### 5. Repository Pattern

```typescript
class GlobalPayPalConfigRepository {
  async getActiveConfig(): Promise<Result<GlobalPayPalConfig | null, Error>>
  async upsertConfig(data): Promise<Result<GlobalPayPalConfig, Error>>
}
```

---

## Configuration

### Environment Variables

| Variable | Description |
|----------|-------------|
| `SECRET_KEY` | AES-256-CBC encryption key (32 bytes hex) |
| `ALLOWED_DOMAIN_PATTERN` | Regex for allowed Saleor domains |
| `APL` | Auth Persistence Layer (`file` or `postgres`) |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | PostgreSQL config |
| `APP_LOG_LEVEL` | Log level (fatal/error/warn/info/debug/trace) |
| `APP_IFRAME_BASE_URL` | For local development with Docker |
| `APP_API_BASE_URL` | For local development with Docker |
| `MANIFEST_APP_ID` | App identifier |
| `OTEL_ENABLED`, `OTEL_ACCESS_TOKEN`, `OTEL_SERVICE_NAME` | OpenTelemetry |
| `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT` | Sentry |

### Database Schema

Run migrations with:
```bash
pnpm migrate:database
```

---

## Commands Reference

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start dev server (port 3005 with inspector) |
| `pnpm build` | Build production bundle |
| `pnpm start` | Start production server |
| `pnpm check-types` | TypeScript type checking |
| `pnpm test:unit` | Run unit tests |
| `pnpm test:integration` | Run integration tests |
| `pnpm test:e2e` | Run Playwright E2E tests |
| `pnpm test:ci` | Run tests with coverage |
| `pnpm generate` | Generate all types |
| `pnpm generate:app-graphql-types` | Generate GraphQL types |
| `pnpm generate:app-webhooks-types` | Generate webhook types |
| `pnpm migrate:database` | Run PostgreSQL migrations |
| `pnpm migrate` | Run webhook migrations |
| `pnpm lint` | Lint codebase |
| `pnpm lint:fix` | Auto-fix linting issues |
| `pnpm fetch-schema` | Fetch Saleor GraphQL schema |

---

## Dependencies

### Runtime Dependencies

| Package | Purpose |
|---------|---------|
| `@saleor/app-sdk` | Saleor app framework |
| `neverthrow` | Result-based error handling |
| `zod` | Schema validation |
| `urql` | GraphQL client |
| `pg` | PostgreSQL driver |
| `@trpc/*` | Type-safe API layer |
| `react-hook-form` | Form handling |
| `@saleor/macaw-ui` | UI components |
| `@opentelemetry/*` | Observability |
| `@sentry/nextjs` | Error tracking |

### Workspace Dependencies

| Package | Purpose |
|---------|---------|
| `@saleor/apps-logger` | Structured logging |
| `@saleor/apps-otel` | OpenTelemetry utilities |
| `@saleor/apps-shared` | Shared utilities |
| `@saleor/apps-trpc` | tRPC setup |
| `@saleor/apps-ui` | Shared UI |
| `@saleor/errors` | Error utilities |
| `@saleor/pg-config-repository` | PostgreSQL repository |
| `@saleor/react-hook-form-macaw` | Form integration |
| `@saleor/webhook-utils` | Webhook utilities |

---

## Payment Flow

```
1. Customer initiates checkout
   ↓
2. PAYMENT_GATEWAY_INITIALIZE_SESSION
   → Returns PayPal Client ID
   ↓
3. Frontend initializes PayPal SDK
   ↓
4. TRANSACTION_INITIALIZE_SESSION
   → Creates PayPal order
   → Returns order ID
   ↓
5. Customer approves in PayPal UI
   ↓
6. TRANSACTION_PROCESS_SESSION
   → Validates approval
   ↓
7. TRANSACTION_CHARGE_REQUESTED
   → Captures funds
   ↓
8. Order complete

Post-Payment:
- TRANSACTION_REFUND_REQUESTED → Refund capture
- TRANSACTION_CANCELATION_REQUESTED → Verify cancellation
```

---

## Testing

### Unit Tests

- **Location:** `src/**/*.test.ts`
- **Framework:** Vitest with jsdom
- **Setup:** `src/__tests__/setup.units.ts`
- **Command:** `vitest --project=unit`

### Integration Tests

- **Location:** `src/__tests__/integration/**/*.test.ts`
- **Setup:** `src/__tests__/integration/setup.integration.ts`
- **Command:** `vitest --project=integration`
- **Note:** Single-threaded to avoid PostgreSQL conflicts

### E2E Tests

- **Framework:** Playwright
- **Command:** `pnpm test:e2e` or `pnpm test:e2e-ui`

---

## Observability

### Logging

```typescript
import { createLogger } from "@/lib/logger";
const logger = createLogger("ModuleName");

logger.info("Message", { contextData });
logger.error("Error", { error });
```

### OpenTelemetry

- Distributed tracing with `@saleor/apps-otel`
- Span attributes for PayPal environment
- Context propagation across webhook calls

### Sentry

- Automatic exception capture
- Context enrichment with transaction IDs
- Error normalization with `BaseError.normalize()`

---

## Security Considerations

1. **Credentials Storage:** Stored in PostgreSQL, never in code/env vars
2. **OAuth Tokens:** Cached in-memory with automatic expiration
3. **Webhook Verification:** Signature validation for Saleor webhooks
4. **PCI Compliance:** Never log PII data (card numbers, CVV)
5. **Environment Separation:** Explicit SANDBOX/LIVE configuration

---

*Generated: January 2026*
