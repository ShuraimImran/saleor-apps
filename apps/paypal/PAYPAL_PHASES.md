# PayPal Integration Phases

This document tracks PayPal integration features by phase, including implementation and testing status.

**Last Updated:** 2026-01-21

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

## Phase 2 (Deferred)

| Feature | Implemented | Tested | Notes |
|---------|-------------|--------|-------|
| PayPal Wallet Vaulting | ❌ No | ❌ No | Save PayPal account |
| Venmo Vaulting | ❌ No | ❌ No | Save Venmo account |
| Apple Pay Vaulting | ❌ No | ❌ No | Save Apple Pay |
| Vault Without Purchase | ❌ No | ❌ No | API exists, not integrated |
| Saved Cards Management UI | ❌ No | ❌ No | Backend ready, needs FE |
| Recurring Billing | ❌ No | ❌ No | Subscriptions API |
| L2/L3 Processing | ❌ No | ❌ No | B2B enhanced data |

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
