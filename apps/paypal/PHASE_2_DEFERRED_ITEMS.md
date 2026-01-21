# Phase 2 Deferred Items

This document tracks features and functionality explicitly deferred from Phase 1 to Phase 2. These items are NOT in scope for the current implementation and will be addressed in Phase 2.

**Document Created:** 2026-01-21
**Source of Truth:** Web Shop Manager - PPCP Connected Path Finalized Solution Scope (FSS)

---

## Vaulting Features Deferred to Phase 2

### 1. PayPal Wallet Vaulting
- **What:** Save PayPal account as payment method for future purchases
- **PayPal API:** `payment_source.paypal` with `vault_instruction` in Orders API
- **Why Deferred:** FSS explicitly lists "Vault (PayPal)" under Phase 2 scope
- **Existing Code:** `PayPalVaultingApi.createSetupToken()` supports `paypal` payment source but is not integrated

### 2. Venmo Vaulting
- **What:** Save Venmo account as payment method for future purchases
- **PayPal API:** `payment_source.venmo` with `vault_instruction` in Orders API
- **Why Deferred:** FSS explicitly lists "Vault (Venmo)" under Phase 2 scope
- **Existing Code:** `PayPalVaultingApi.createSetupToken()` supports `venmo` payment source but is not integrated

### 3. Apple Pay Vaulting
- **What:** Save Apple Pay as payment method for future purchases
- **PayPal API:** Apple Pay token vaulting through PayPal
- **Why Deferred:** FSS explicitly lists "Vault (Apple Pay)" under Phase 2 scope
- **Existing Code:** None

### 4. Vault Without Purchase Flow (All Payment Methods)
- **What:** Customer saves payment method from account settings without making a purchase
- **PayPal API:** Setup Tokens API (`/v3/vault/setup-tokens`)
- **Why Deferred:** Phase 1 focuses on "Save During Purchase" flow which is the primary checkout use case
- **Existing Code:** `PayPalVaultingApi.createSetupToken()` exists but requires frontend UI and additional webhook handlers

### 5. Saved Payment Methods Management UI (Backend Support)
- **What:** Backend endpoints for customers to view, list, and delete their saved payment methods
- **PayPal API:** `listPaymentTokens()`, `deletePaymentToken()` - already implemented in `PayPalVaultingApi`
- **Why Deferred:** Requires coordination with frontend team; Phase 1 focuses on core save/use flows
- **Existing Code:** API methods exist, tRPC handlers needed

---

## Other Phase 2 Features (Per FSS)

### 6. Recurring Billing Module
- **What:** Subscription and recurring payment processing
- **PayPal API:** Subscriptions API, Billing Plans API
- **Why Deferred:** FSS Phase 2 scope

### 7. L2/L3 Processing
- **What:** Level 2 and Level 3 card data for B2B transactions (lower interchange rates)
- **PayPal API:** Enhanced data fields in Orders API
- **Why Deferred:** FSS Phase 2 scope

---

## Phase 1 Scope (For Reference)

Phase 1 ACDC Card Vaulting includes:
1. **Save During Purchase** - Customer saves card while completing checkout
2. **Return Buyer** - Customer uses previously saved card at checkout
3. **Guest Checkout** - Proceeds normally without vaulting option (logged-in customers only for vaulting)

---

## Notes

- This document should be updated if scope changes
- Each Phase 2 item should be converted to implementation tasks when Phase 2 begins
- Existing code references are accurate as of document creation date
