# PayPal Integration Phases

This document tracks PayPal integration features by phase, including implementation and testing status.

**Last Updated:** 2026-01-23

---

## Phase 1

### Core Payment Features

| Feature | Implemented | Tested | Notes |
|---------|-------------|--------|-------|
| Branded PayPal Buttons | ✅ Yes | ❌ No | Standard PayPal checkout |
| Branded Venmo | ✅ Yes | ❌ No | Via PayPal buttons |
| Pay Later | ✅ Yes | ❌ No | Via PayPal buttons |
| ACDC (Advanced Card Processing) | ✅ Yes | ❌ No | Direct card entry |
| Apple Pay | ✅ Yes | ❌ No | Domain registration supported |
| Google Pay | ✅ Yes | ❌ No | Via merchant onboarding |

### Vaulting (Card Only)

| Feature | Implemented | Tested | Notes |
|---------|-------------|--------|-------|
| Save During Purchase | ✅ Yes | ❌ No | `store_in_vault` in Orders API |
| Return Buyer (Use Saved Card) | ✅ Yes | ❌ No | `vault_id` in Orders API |
| Customer Vault Mapping | ✅ Yes | ❌ No | DB table + repository |
| List Saved Cards | ✅ Yes | ❌ No | tRPC + PaymentGatewayInitialize |
| Delete Saved Card | ✅ Yes | ❌ No | tRPC handler |

### Merchant Onboarding

| Feature | Implemented | Tested | Notes |
|---------|-------------|--------|-------|
| Partner Referral Creation | ✅ Yes | ❌ No | ISU flow |
| Merchant Status Check | ✅ Yes | ❌ No | Seller status API |
| Payment Method Readiness | ✅ Yes | ❌ No | Capability checks |
| Apple Pay Domain Registration | ✅ Yes | ❌ No | Wallet domains API |

### Transaction Operations

| Feature | Implemented | Tested | Notes |
|---------|-------------|--------|-------|
| Capture (Charge) | ✅ Yes | ❌ No | Orders API capture |
| Authorize | ✅ Yes | ❌ No | Orders API authorize |
| Refund (Full/Partial) | ✅ Yes | ❌ No | Payments API refund |
| Cancel/Void | ✅ Yes | ❌ No | Order status verification |

---

## Phase 2 (Vaulting - All Payment Methods)

| Feature | Implemented | Tested | Notes |
|---------|-------------|--------|-------|
| PayPal Wallet Vaulting | ✅ Yes | ❌ No | Vault with purchase, return buyer, MIT |
| Venmo Vaulting | ✅ Yes | ❌ No | Vault with purchase, return buyer (no MIT - buyer-present only) |
| Apple Pay Vaulting | ✅ Yes | ❌ No | Vault with purchase, return buyer, MIT |
| Vault Without Purchase (RBM) | ✅ Yes | ❌ No | Card, PayPal, Venmo via Setup Tokens |
| List Saved Payment Methods | ✅ Yes | ❌ No | All types in PaymentGatewayInitialize |
| Delete Saved Payment Method | ✅ Yes | ❌ No | tRPC handler |
| User ID Token Generation | ✅ Yes | ❌ No | For JS SDK `data-user-id-token` |

---

## Phase 2 (Remaining - Non-Vaulting Features)

| Feature | Implemented | Tested | Notes |
|---------|-------------|--------|-------|
| L2/L3 Processing | ❌ No | ❌ No | B2B enhanced data |
| Recurring Billing Module | ❌ No | ❌ No | Subscriptions API |
| Pay Later Messaging | ❌ No | ❌ No | JS SDK messaging component |
| Pay Later Messaging Configurator | ❌ No | ❌ No | Admin panel config |
| RTAU (Real Time Account Updater) | ❌ No | ❌ No | Card update notifications |
| Package Tracking | ❌ No | ❌ No | Order API tracking info |
| Fastlane | ❌ No | ❌ No | Accelerated checkout |

---

## IWT (Integration Walkthrough) Status

| Requirement | Status | Notes |
|-------------|--------|-------|
| BN Code in API calls | ✅ Done | Partner attribution |
| Auth Assertion Header | ✅ Done | Merchant context |
| Line Items in Orders | ✅ Done | Product details |
| Shipping Address | ✅ Done | Passed to PayPal |
| Soft Descriptor | ✅ Done | Configurable per tenant |
| Platform Fees | ✅ Done | Partner fee collection |
| Vaulting (ACDC) | ✅ Done | Phase 1 scope |
| Vaulting (PayPal Wallet) | ✅ Done | Phase 2 scope |
| Vaulting (Venmo) | ✅ Done | Phase 2 scope (no MIT) |
| Vaulting (Apple Pay) | ✅ Done | Phase 2 scope |
| Vault Without Purchase (RBM) | ✅ Done | Phase 2 scope |
| User ID Token | ✅ Done | For JS SDK vaulting |

---

## Testing Checklist

### Unit Tests Needed
- [ ] Customer vault repository
- [ ] Vaulting in TransactionInitializeSession
- [ ] Vault response handling in TransactionChargeRequested
- [ ] Saved payment methods in PaymentGatewayInitialize
- [ ] tRPC handlers for vaulting

### Integration Tests Needed
- [ ] Save card during purchase flow
- [ ] Return buyer flow with saved card
- [ ] List/delete saved cards

### E2E Tests Needed
- [ ] Complete checkout with card vaulting
- [ ] Return buyer checkout
- [ ] Refund on vaulted card transaction

---

## References

- [PHASE_2_DEFERRED_ITEMS.md](./PHASE_2_DEFERRED_ITEMS.md) - Detailed Phase 2 scope
- [README.md](./README.md) - Technical documentation
- [CODEBASE_ANALYSIS.md](./CODEBASE_ANALYSIS.md) - Architecture overview
