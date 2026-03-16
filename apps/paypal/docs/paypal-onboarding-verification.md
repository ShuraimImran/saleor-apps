# PayPal Merchant Onboarding - Summary & Verification

## Onboarding Flow

The process for onboarding each WSM tenant's merchants:

1. **Set up Webhooks** - listen for merchant integration events
2. **Generate a signup link** - via PayPal's "Create Partner Referral" API, passing required features/capabilities
3. **Add signup link to your site** - the "Connect with PayPal" button in the Saleor Dashboard
4. **Redirect seller to a return URL** - after they complete PayPal's onboarding flow
5. **Track seller onboarding status** - via the "Show Seller Status" API

## Post-Onboarding Status Checks

Before processing transactions, verify:

| Flag | If `false` |
|------|-----------|
| `PRIMARY_EMAIL_CONFIRMED` | Seller must confirm email on paypal.com - block payments until done |
| `PAYMENTS_RECEIVABLE` | Account restriction - direct seller to PayPal support |
| `OAUTH_INTEGRATIONS` (empty) | Permissions not granted - seller must re-onboard |

## Feature Readiness Checks (via "Get Seller Status" API)

| Feature | Required Product | Required Capability |
|---------|-----------------|-------------------|
| **ACDC (Advanced Cards)** | `PPCP_CUSTOM` = SUBSCRIBED | `CUSTOM_CARD_PROCESSING` = ACTIVE |
| **Apple Pay** | `PPCP_CUSTOM` + `PAYMENT_METHODS` = SUBSCRIBED | `APPLE_PAY` = ACTIVE |
| **Google Pay** | `PPCP_CUSTOM` + `PAYMENT_METHODS` = SUBSCRIBED | `GOOGLE_PAY` = ACTIVE |
| **Vaulting** | `ADVANCED_VAULTING` = SUBSCRIBED | `PAYPAL_WALLET_VAULTING_ADVANCED` = ACTIVE + specific scopes |

## Best Practices

- Pre-fill seller data in the "Create Partner Referral" request
- Use a **unique `tracking_id`** per referral
- Don't share action URLs across sellers
- Periodically re-check seller status
- Subscribe to `MERCHANT.PARTNER-CONSENT.REVOKED` webhook

## Sandbox Testing Note

Sandbox accounts created through onboarding need **manual email confirmation** (sandbox doesn't send real emails) - requires linking the test account in the PayPal Developer Dashboard and confirming via Sandbox Notifications.

---

## Implementation vs Document - Verified

### All Steps Implemented

| PDF Step | Implementation | Status |
|----------|---------------|--------|
| **1. Set up Webhooks** | `paypal-webhook-manager.ts` - registers `MERCHANT.PARTNER-CONSENT.REVOKED` + `CUSTOMER.MERCHANT-INTEGRATION.PRODUCT-SUBSCRIPTION-UPDATED` | Done |
| **2. Generate signup link** | `create-merchant-referral-trpc-handler.ts` -> `POST /v2/customer/partner-referrals` | Done |
| **3. Add signup link to site** | `merchant-connection-section.tsx` - "Connect PayPal Account" button using AppBridge redirect | Done |
| **4. Redirect to return URL** | `src/pages/paypal-callback.tsx` - captures `merchantIdInPayPal`, `trackingId`, stores in localStorage | Done |
| **5. Track seller status** | `refresh-merchant-status-trpc-handler.ts` -> `GET /v1/customer/partners/{id}/merchant-integrations/{id}` | Done |

### Status Flag Checks - All Implemented

| Flag | Handling |
|------|---------|
| `PRIMARY_EMAIL_CONFIRMED` | Stored in DB, blocks `COMPLETED` status if false |
| `PAYMENTS_RECEIVABLE` | Stored in DB, blocks `COMPLETED` status if false |
| `OAUTH_INTEGRATIONS` (empty) | Sets `oauth_integrated = false`, blocks completion |

### Feature Readiness Checks - All Match PDF

| Feature | Product Check | Capability Check | Status |
|---------|--------------|-----------------|--------|
| **ACDC** | `PPCP_CUSTOM` SUBSCRIBED | `CUSTOM_CARD_PROCESSING` ACTIVE (no limits) | Matches |
| **Apple Pay** | `PPCP_CUSTOM` + `PAYMENT_METHODS` SUBSCRIBED | `APPLE_PAY` ACTIVE | Matches |
| **Google Pay** | `PPCP_CUSTOM` + `PAYMENT_METHODS` SUBSCRIBED | `GOOGLE_PAY` ACTIVE | Matches |
| **Vaulting** | `ADVANCED_VAULTING` SUBSCRIBED | `PAYPAL_WALLET_VAULTING_ADVANCED` ACTIVE + 3 OAuth scopes | Matches |

### Partner Referral Builder Defaults

The `PartnerReferralBuilder.createDefault()` requests all the right products and capabilities:
- `PPCP`, `PAYMENT_METHODS`, `ADVANCED_VAULTING` products
- `APPLE_PAY`, `GOOGLE_PAY`, `PAYPAL_WALLET_VAULTING_ADVANCED` capabilities
- Features: `PAYMENT`, `REFUND`, `VAULT`, `BILLING_AGREEMENT`

### Storage Strategy

- **PostgreSQL** (`paypal_merchant_onboarding` table) - stores full onboarding state, readiness flags, status history
- **Saleor Metadata** - stores merchant credentials (`merchantClientId`, `merchantId`, `merchantEmail`) for runtime payment processing

### One Note

The country is currently **hardcoded to "US"** in the UI (`merchant-connection-section.tsx`). For production with international merchants, this should be made dynamic.
