# Phase 2 Implementation Status

This document tracks Phase 2 features. Vaulting is complete; other features remain.

**Document Created:** 2026-01-21
**Last Updated:** 2026-01-24
**Status:** Phase 2 Vaulting Complete | Other Features Pending

---

## Phase 2 Vaulting Features - COMPLETED

### 1. PayPal Wallet Vaulting ✅ IMPLEMENTED
- **What:** Save PayPal account as payment method for future purchases
- **Flows Implemented:**
  - Vault with Purchase (`savePaymentMethod: true, paymentMethodType: "paypal"`)
  - Return Buyer (`vaultId` with saved PayPal wallet)
  - MIT - Buyer Not Present (`merchantInitiated: true`)
- **Files Modified:**
  - `src/modules/paypal/paypal-orders-api.ts` - PayPal vault attributes
  - `src/app/api/webhooks/saleor/transaction-initialize-session/use-case.ts` - Flow handling
  - `src/app/api/webhooks/saleor/payment-gateway-initialize-session/use-case.ts` - List saved PayPal wallets

### 2. Venmo Vaulting ✅ IMPLEMENTED
- **What:** Save Venmo account as payment method for future purchases
- **Flows Implemented:**
  - Vault with Purchase (`savePaymentMethod: true, paymentMethodType: "venmo"`)
  - Return Buyer (`vaultId` with saved Venmo)
- **Note:** MIT (Merchant Initiated Transactions) NOT supported - Venmo is buyer-present only per FSS
- **Files Modified:**
  - `src/modules/paypal/paypal-orders-api.ts` - Venmo vault attributes
  - `src/app/api/webhooks/saleor/transaction-initialize-session/use-case.ts` - Flow handling
  - `src/app/api/webhooks/saleor/payment-gateway-initialize-session/use-case.ts` - List saved Venmo

### 3. Apple Pay Vaulting ✅ IMPLEMENTED
- **What:** Save Apple Pay as payment method for future purchases
- **Flows Implemented:**
  - Vault with Purchase (`savePaymentMethod: true, paymentMethodType: "apple_pay"`)
  - Return Buyer (`vaultId` with saved Apple Pay)
  - MIT - Recurring/Unscheduled (`merchantInitiated: true`)
- **Files Modified:**
  - `src/modules/paypal/paypal-orders-api.ts` - Apple Pay payment source with vault attributes
  - `src/app/api/webhooks/saleor/transaction-initialize-session/use-case.ts` - Flow handling
  - `src/app/api/webhooks/saleor/payment-gateway-initialize-session/use-case.ts` - List saved Apple Pay

### 4. Vault Without Purchase (RBM) ✅ IMPLEMENTED
- **What:** Customer saves payment method from account settings without making a purchase
- **PayPal API:** Setup Tokens API (`/v3/vault/setup-tokens`)
- **Supported Payment Methods:** Card, PayPal, Venmo
- **Files Modified:**
  - `src/modules/customer-vault/trpc-handlers/create-setup-token-handler.ts` - Supports card/paypal/venmo
  - `src/modules/customer-vault/trpc-handlers/create-payment-token-handler.ts` - Returns all payment method details

### 5. Saved Payment Methods Management ✅ IMPLEMENTED
- **What:** Backend endpoints for listing and deleting saved payment methods
- **Implemented:**
  - `listPaymentTokens` - List all saved payment methods (card, paypal, venmo, apple_pay)
  - `deletePaymentToken` - Delete a saved payment method
  - `PaymentGatewayInitialize` returns `savedPaymentMethods` array with all types
- **Files:**
  - `src/modules/paypal/paypal-vaulting-api.ts` - API methods
  - `src/modules/customer-vault/trpc-handlers/` - tRPC handlers
  - `src/app/api/webhooks/saleor/payment-gateway-initialize-session/use-case-response.ts` - SavedPaymentMethod types

### 6. User ID Token Generation ✅ IMPLEMENTED
- **What:** JWT token for JS SDK `data-user-id-token` attribute
- **Purpose:** Enables vaulted PayPal/Venmo buttons to show saved payment methods
- **File:** `src/app/api/webhooks/saleor/payment-gateway-initialize-session/use-case.ts`
- **Response Field:** `userIdToken` in PaymentGatewayInitialize response

---

## Phase 2 Remaining Features (Non-Vaulting)

Per FSS Page 3, the following features are in Phase 2 scope but not yet implemented:

### 1. L2/L3 Processing
- **What:** Level 2 and Level 3 card data for B2B transactions (lower interchange rates)
- **PayPal API:** Enhanced data fields in Orders API
- **Status:** Not started

### 2. Recurring Billing Module (RBM)
- **What:** Subscription and recurring payment processing
- **PayPal API:** Subscriptions API, Billing Plans API
- **Status:** Not started

### 3. Pay Later Messaging
- **What:** Promotional messaging for Pay Later offers
- **PayPal API:** JS SDK messaging component
- **Status:** Not started

### 4. Pay Later Messaging Configurator
- **What:** Admin panel configuration for Pay Later messaging
- **Status:** Not started

### 5. RTAU (Real Time Account Updater)
- **What:** Real-time card update notifications for vaulted cards
- **PayPal API:** SCA Indicators integration
- **Status:** Not started

### 6. Package Tracking
- **What:** Update item tracking information in transaction details
- **PayPal API:** Order API tracking fields
- **Status:** Not started

### 7. Fastlane
- **What:** Accelerated checkout experience
- **PayPal API:** Fastlane SDK integration
- **Status:** Not started (separate document required per FSS)

---

## IWT Compliance (Page 15 - Vaulting Requirements)

| Requirement | Status |
|-------------|--------|
| User ID Token contains PayPal-Auth-Assertion header | ✅ Done |
| Customer ID passed to "create order" for existing customers | ✅ Done |
| PayPal: Vault with purchase option | ✅ Done |
| PayPal: Vault without purchase (RBM) | ✅ Done |
| PayPal: Return buyer one-click flow | ✅ Done |
| PayPal: Buyer-not-present (MIT) transactions | ✅ Done |
| Venmo: Vault with purchase option | ✅ Done |
| Venmo: Return buyer one-click flow | ✅ Done |
| ACDC: Vault with purchase option | ✅ Done |
| ACDC: Return buyer saved card selection | ✅ Done |
| ACDC: Multiple saved cards selection | ✅ Done |

---

## References

- [PAYPAL_PHASES.md](./PAYPAL_PHASES.md) - Phase tracking
- [FRONTEND_VAULTING_INTEGRATION.md](./FRONTEND_VAULTING_INTEGRATION.md) - Frontend integration guide
- [IWT_REQUIREMENTS_ANALYSIS.md](./IWT_REQUIREMENTS_ANALYSIS.md) - IWT compliance details
