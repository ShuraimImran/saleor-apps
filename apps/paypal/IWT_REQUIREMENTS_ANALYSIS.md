# IWT Requirements Analysis

This document analyzes the current implementation status against PayPal's Integration Walkthrough (IWT) requirements. The IWT is PayPal's certification process that must be completed before live account provisioning.

**Document Created:** 2026-01-22
**Last Updated:** 2026-01-24
**Source Documents:** IWT Checklist, FSS, Integration Guide
**Codebase Analyzed:** apps/paypal

---

## IWT Submission Materials

Before certification, the following materials must be prepared and submitted to the Integration Engineer (IE):

| Material | Status | Notes |
|----------|--------|-------|
| API Samples (request/response) | Not Started | Need plaintext samples for each API call type |
| Video Recordings | Not Started | Demo videos of all flows |
| Questionnaire | Not Started | Screenshots and confirmations |

---

## Onboarding Requirements (IWT Pages 3-7)

### Pre-Onboarding

| Requirement | Backend | Frontend | Notes |
|-------------|---------|----------|-------|
| PayPal presented as first payment processor | N/A | Not Done | Frontend UI decision |
| Onboarding flow via sign-up link/button | Done | Not Done | Partner referral API ready |
| Onboarding in mini-browser or full redirect | N/A | Not Done | Frontend handles redirect |
| Partner referral features match Solution Design | Done | N/A | Builder pattern supports all features |
| Return URL provided in partner referral | Done | N/A | `partner_config_override.return_url` |
| ACDC-ineligible countries handled | Done | Not Done | Backend checks readiness, FE must hide card fields |
| Apple Pay partner referral includes PAYMENT_METHODS + APPLE_PAY | Done | N/A | In PartnerReferralBuilder |
| Google Pay partner referral includes PAYMENT_METHODS + GOOGLE_PAY | Done | N/A | In PartnerReferralBuilder |
| Vaulting partner referral includes ADVANCED_VAULTING + capability + features | Done | N/A | In PartnerReferralBuilder |

### Post-Onboarding

| Requirement | Backend | Frontend | Notes |
|-------------|---------|----------|-------|
| Seller shown PayPal account email | Done | Not Done | Backend returns email, FE must display |
| PayPal Checkout defaulted ON for product pages | N/A | Not Done | Frontend config |
| PayPal Checkout defaulted ON for cart pages | N/A | Not Done | Frontend config |
| PayPal Checkout defaulted ON for payment pages | N/A | Not Done | Frontend config |
| Seller notified if unable to transact (email unconfirmed) | Done | Not Done | Backend checks flags, FE must show message |
| Seller notified if unable to transact (payments not receivable) | Done | Not Done | Backend checks flags, FE must show message |
| Seller notified if unable to transact (permissions not granted) | Done | Not Done | Backend checks scopes, FE must show message |
| Seller shown onboarding status (PayPal ID, scopes) | Done | Not Done | Backend returns data, FE must display |
| Seller can disconnect/reconnect PayPal | Partial | Not Done | Can "forget" merchant, FE needs UI |
| Partner can request seller status by payer ID | Done | N/A | Show Seller Status API implemented |
| Graceful handling of refund with insufficient balance | Done | Not Done | Backend returns error, FE must display |
| Sellers can issue refunds through platform | Done | Not Done | Backend handles, FE needs UI |
| Pay Later info shown, sellers can disable | N/A | Not Done | JS SDK `disable_funding=paylater` |
| Seller notified of ACDC vetting status | Done | Not Done | Backend returns status, FE must display |
| Seller notified of vaulting vetting status | Done | Not Done | Backend returns status, FE must display |
| Seller informed if vaulting is available | Done | Not Done | Backend checks readiness, FE must display |

---

## Payments Requirements (IWT Pages 8-9)

### Integration Method - JS SDK

| Requirement | Backend | Frontend | Notes |
|-------------|---------|----------|-------|
| JS SDK errors caught and handled | N/A | Not Done | Frontend implementation |
| JS SDK loaded from official URL (not local) | N/A | Not Done | Frontend implementation |
| JS SDK configured with required params | N/A | Not Done | client-id, merchant-id, commit, currency, intent |
| BN code in `data-partner-attribution-id` | N/A | Not Done | Frontend must add attribute |

### Integration Method - REST API

| Requirement | Backend | Frontend | Notes |
|-------------|---------|----------|-------|
| Access tokens re-used until expiration | Done | N/A | `PayPalOAuthTokenCache` implemented |
| BN code in `PayPal-Partner-Attribution-Id` header | Done | N/A | Included in all order requests |

### Checkout

| Requirement | Backend | Frontend | Notes |
|-------------|---------|----------|-------|
| Buyers not required to input info available via PayPal | Partial | Not Done | Backend prefills payer, FE should use PayPal data |
| Each order specifies seller via merchant ID | Done | N/A | Via `payee` or Auth Assertion header |
| Orders include line-item detail | Done | N/A | `purchase_units[].items` populated |
| Thank you page shows payment source, email, addresses | N/A | Not Done | Frontend must display from response |

---

## PayPal Checkout Requirements (IWT Pages 10-13)

| Requirement | Backend | Frontend | Notes |
|-------------|---------|----------|-------|
| `app_switch_preference=true` in create order | Not Done | N/A | Need to add to experience_context |
| `appSwitchWhenAvailable=true` in JS SDK Buttons | N/A | Not Done | Frontend JS SDK config |
| One-time payments used (not vaulting) for PayPal Checkout | Done | N/A | Default behavior |
| Shipping address in create order for PayPal/Venmo | Done | N/A | Passed in `purchase_units[].shipping` |
| PayPal buttons on cart page (digital goods) | N/A | Not Done | Frontend placement |
| Pay Now experience on payment page (digital) | Done | Not Done | Backend supports, FE needs `commit=true` |
| Pay Now experience on product page (digital) | N/A | Not Done | Frontend placement |
| PayPal buttons equal prominence with other methods | N/A | Not Done | Frontend UI |
| PayPal logos from official sources | N/A | Not Done | Frontend assets |
| "PayPal" capitalized correctly | N/A | Not Done | Frontend text |
| No additional surcharge for PayPal | N/A | Not Done | Business/frontend decision |
| Buyers returned to seller site after cancel | Done | Not Done | Backend provides cancel_url, FE handles |
| Seller name in "Cancel and return" link | Done | N/A | Via `brand_name` in experience_context |
| Checkout complete within 2 steps after PayPal | N/A | Not Done | Frontend flow design |
| Orders not created until buyer clicks PayPal button | N/A | Not Done | Frontend event handling |
| Orders updated via PATCH if buyer changes purchase | Done | N/A | `patchOrder` implemented |
| Digital goods specify `NO_SHIPPING` | Done | N/A | `shipping_preference` supported |
| Button messaging shown (Pay Later) | N/A | Not Done | Frontend JS SDK component |
| Venmo button rendered for qualifying buyers | N/A | Not Done | Frontend `enable-funding=venmo` |
| Thank you page shows Venmo if used | N/A | Not Done | Frontend must check payment_source |

### Shipping Module

| Requirement | Backend | Frontend | Notes |
|-------------|---------|----------|-------|
| Shipping callback URL in `order_update_callback_config` | Done | N/A | Supported in create order |
| Pay Now experience for shipping orders | Done | Not Done | `user_action: "PAY_NOW"` supported |
| Server responds 200/422 to shipping callbacks | Done | N/A | Webhook handler exists |
| Server parses shipping options and responds | Done | N/A | Callback processing implemented |

### Contact Module

| Requirement | Backend | Frontend | Notes |
|-------------|---------|----------|-------|
| Buyer email/phone in `purchase_units[].shipping` | Done | N/A | Extracted from Saleor checkout |
| Buyers can update contact in PayPal Checkout | Done | N/A | PayPal handles, we receive updated data |

---

## Expanded Checkout Requirements (IWT Page 14)

| Requirement | Backend | Frontend | Notes |
|-------------|---------|----------|-------|
| ACDC: Card fields presented during checkout | N/A | Not Done | Frontend JS SDK `card-fields` component |
| Apple Pay: Domain registered with PayPal | Done | N/A | `registerApplePayDomain` implemented |
| Apple Pay: Buttons on product and cart pages | N/A | Not Done | Frontend placement |
| Apple Pay: Thank you shows Apple Pay as source | N/A | Not Done | Frontend must check payment_source |
| Google Pay: Buttons on cart, product, checkout | N/A | Not Done | Frontend placement |
| Google Pay: Thank you shows Google Pay as source | N/A | Not Done | Frontend must check payment_source |

---

## Vaulting Requirements (IWT Pages 15-16)

### General Vaulting

| Requirement | Backend | Frontend | Notes |
|-------------|---------|----------|-------|
| `PayPal-Auth-Assertion` in generate user ID token calls | Done | N/A | Auth Assertion implemented |
| Existing customer ID passed when vaulting new method | Done | N/A | Customer vault repository handles |

### PayPal Wallet Vaulting ✅ COMPLETE

| Requirement | Backend | Frontend | Notes |
|-------------|---------|----------|-------|
| Option to vault PayPal during checkout | ✅ Done | Not Done | `savePaymentMethod: true, paymentMethodType: "paypal"` |
| Vault PayPal without purchase | ✅ Done | Not Done | Setup tokens flow via tRPC |
| Return buyer: one-click checkout with vaulted PayPal | ✅ Done | Not Done | `vaultId` parameter |
| Vaulted PayPal/Venmo shown on buttons | ✅ Done | Not Done | `userIdToken` returned in response |
| `data-user-id-token` populated for branded methods | ✅ Done | Not Done | Backend generates, FE must use |
| Buyer-not-present transactions with vaulted PayPal | ✅ Done | N/A | `merchantInitiated: true` |

### Venmo Vaulting ✅ COMPLETE

| Requirement | Backend | Frontend | Notes |
|-------------|---------|----------|-------|
| Option to vault Venmo during checkout | ✅ Done | Not Done | `savePaymentMethod: true, paymentMethodType: "venmo"` |
| Return buyer: one-click with vaulted Venmo | ✅ Done | Not Done | `vaultId` parameter |
| Note: Venmo MIT | N/A | N/A | NOT supported - Venmo is buyer-present only per FSS |

### ACDC Card Vaulting

| Requirement | Backend | Frontend | Notes |
|-------------|---------|----------|-------|
| Option to vault card during checkout | Done | Not Done | Backend ready, FE needs checkbox |
| Return buyer: select vaulted cards | Done | Not Done | Backend ready, FE needs UI |
| Return buyer: pay with AND vault new card | Done | Not Done | Backend ready, FE needs UI |
| Return buyer: select between multiple cards | Done | Not Done | Backend returns list, FE needs picker |
| View saved cards and choose for transaction | Done | Not Done | tRPC handler ready, FE needs UI |

---

## Identified Backend Gaps

### Critical Gaps - RESOLVED

| Gap | Description | Status | Resolution |
|-----|-------------|--------|------------|
| **User ID Token Generation** | Missing endpoint to generate user ID token for JS SDK. | ✅ Fixed | Added `generateUserIdToken()` method to PayPalClient (`paypal-client.ts:321-385`) |
| **PayPal Webhook Signature Verification** | Webhooks were unauthenticated. | ✅ Fixed | Implemented full verification in `paypal-webhook-verification.ts` using PayPal's verify-webhook-signature API |
| **App Switch Preference** | Need `app_switch_preference=true` for mobile checkout. | ✅ Fixed | Added to `payment_source.paypal.experience_context` in transaction-initialize-session use-case |

### Vault Webhook Handlers - RESOLVED

PayPal webhook handlers now support:
- `MERCHANT.ONBOARDING.COMPLETED` ✅
- `MERCHANT.PARTNER-CONSENT.REVOKED` ✅
- `VAULT.PAYMENT-TOKEN.CREATED` ✅ (Added in `platform-events/route.ts`)
- `VAULT.PAYMENT-TOKEN.DELETED` ✅ (Added in `platform-events/route.ts`)
- `PAYMENT.CAPTURE.COMPLETED` ✅ (Already existed)
- `PAYMENT.CAPTURE.DENIED` ✅ (Already existed)
- `PAYMENT.CAPTURE.REFUNDED` ✅ (Already existed)
- `PAYMENT.CAPTURE.REVERSED` ✅ (Already existed)

### Phase 2 Vaulting ✅ COMPLETE

| Item | Status | Notes |
|------|--------|-------|
| PayPal wallet vaulting | ✅ Done | Vault with purchase, return buyer, MIT |
| Venmo vaulting | ✅ Done | Vault with purchase, return buyer (no MIT) |
| Apple Pay vaulting | ✅ Done | Vault with purchase, return buyer, MIT |
| Vault without purchase (RBM) | ✅ Done | Setup tokens flow for card/paypal/venmo |
| User ID Token generation | ✅ Done | For JS SDK `data-user-id-token` |

### Phase 2 Remaining (Non-Vaulting)

| Item | Priority | Notes |
|------|----------|-------|
| L2/L3 Processing | Phase 2 | B2B enhanced data |
| Recurring Billing Module | Phase 2 | Subscriptions API |
| Pay Later Messaging | Phase 2 | JS SDK component |
| RTAU | Phase 2 | Card update notifications |
| Package Tracking | Phase 2 | Order API tracking |
| Fastlane | Phase 2 | Accelerated checkout |

---

## Summary: What's Remaining

### Backend Work - COMPLETED

| Item | Priority | Status | Notes |
|------|----------|--------|-------|
| User ID token generation | Critical | ✅ Done | `PayPalClient.generateUserIdToken()` added |
| Webhook signature verification | Critical | ✅ Done | `verifyWebhookSignature()` implemented |
| App Switch preference | High | ✅ Done | Added to transaction-initialize-session |
| Vault webhook handlers | Medium | ✅ Done | VAULT.PAYMENT-TOKEN.* events handled |

### Backend Work Remaining (Phase 2)

### Frontend Work Remaining

| Item | Priority | Complexity | Notes |
|------|----------|------------|-------|
| PayPal JS SDK integration | Critical | High | Core requirement for all payment methods |
| Card fields rendering | Critical | Medium | ACDC via hosted fields |
| PayPal/Venmo buttons | Critical | Medium | Standard checkout flow |
| Apple Pay button | High | Medium | With domain verification |
| Google Pay button | High | Medium | Standard integration |
| Vaulting UI (checkbox, saved cards) | High | Medium | For ACDC Phase 1 |
| Merchant onboarding status display | High | Medium | Show PayPal email, status, errors |
| Thank you page payment details | Medium | Low | Show payment source, addresses |
| Pay Later messaging | Medium | Low | JS SDK component |
| Seller dashboard (disconnect, status) | Medium | Medium | Manage PayPal connection |

### Testing Remaining

| Item | Priority | Notes |
|------|----------|-------|
| Unit tests for vaulting code | High | Customer vault repo, webhook handlers |
| Integration tests | High | Full vaulting flows |
| E2E tests | High | All payment methods, vaulting scenarios |
| Sandbox testing | Critical | Required for IWT submission |

### IWT Submission Materials

| Item | Priority | Notes |
|------|----------|-------|
| API samples collection | Critical | All API request/response pairs |
| Video recordings | Critical | All flows (onboarding, payments, vaulting) |
| Questionnaire completion | Critical | Screenshots, confirmations |

---

## IWT Readiness Checklist

### Ready for IWT (Backend Complete)

- [x] BN code in API calls
- [x] Auth Assertion header
- [x] OAuth token caching
- [x] Partner referral creation
- [x] Seller status checking
- [x] Order creation with line items
- [x] Shipping address handling
- [x] Platform fees
- [x] Soft descriptors
- [x] Capture/Authorize/Refund
- [x] ACDC card vaulting (save during purchase)
- [x] ACDC return buyer (use saved card)
- [x] Apple Pay domain registration
- [x] Payment method readiness checks
- [x] User ID token generation (for JS SDK vaulting)
- [x] Webhook signature verification (security)
- [x] App switch preference (mobile checkout)
- [x] Vault webhook handlers (PAYMENT-TOKEN.CREATED/DELETED)

### Needs Frontend Implementation

- [ ] PayPal JS SDK integration
- [ ] Card fields (ACDC)
- [ ] PayPal/Venmo/Apple Pay/Google Pay buttons
- [ ] Vaulting UI (checkbox, saved cards picker)
- [ ] Merchant onboarding UI
- [ ] Thank you page details
- [ ] Pay Later messaging
- [ ] Error handling and display

### Phase 2 Vaulting ✅ COMPLETE

- [x] PayPal wallet vaulting
- [x] Venmo vaulting
- [x] Apple Pay vaulting
- [x] Vault without purchase (RBM)
- [x] User ID Token generation

### Phase 2 Remaining (Non-Vaulting - To Be Implemented)

- [ ] L2/L3 Processing
- [ ] Recurring Billing Module
- [ ] Pay Later Messaging
- [ ] RTAU
- [ ] Package Tracking
- [ ] Fastlane

---

## Next Steps

1. **Confirm IWT Scope with IE**: Ask PayPal IE which features are required for initial live provisioning
2. **Frontend Development**: Begin JS SDK integration and vaulting UI
3. ~~**Backend Gaps**: Add app_switch_preference, user ID token endpoint~~ ✅ COMPLETED
4. **Testing**: Write unit/integration tests for implemented features
5. **Sandbox Testing**: Complete end-to-end testing in PayPal sandbox
6. **Prepare IWT Materials**: Collect API samples, record videos, complete questionnaire
7. **Submit for IWT**: Send materials to IE for review

---

## References

- [PAYPAL_PHASES.md](./PAYPAL_PHASES.md) - Phase tracking
- [PHASE_2_DEFERRED_ITEMS.md](./PHASE_2_DEFERRED_ITEMS.md) - Deferred features
- IWT Checklist (16 pages) - PayPal certification requirements
- Integration Guide (26 pages) - Technical specification
- FSS - Finalized Solution Scope
