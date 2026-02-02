# Vault Without Purchase - Storefront Integration Guide

Save a payer's card **without** requiring a purchase. This is used on pages like
"My Account > Payment Methods > Add Card" where the buyer wants to save a card
for future use.

> This flow does **not** go through Saleor webhooks. It calls the PayPal Payment
> App's tRPC API directly.

---

## How It Works (High-Level)

```
┌─────────────┐         ┌──────────────────┐         ┌─────────┐
│  Storefront  │         │  PayPal Payment  │         │  PayPal │
│  (Next.js)   │         │  App (tRPC API)  │         │   API   │
└──────┬───────┘         └────────┬─────────┘         └────┬────┘
       │                          │                        │
       │  1. createSetupToken     │                        │
       │ ────────────────────────>│  POST /v3/vault/       │
       │                          │  setup-tokens          │
       │                          │ ──────────────────────>│
       │                          │                        │
       │    { setupTokenId }      │   { id, status }       │
       │ <────────────────────────│ <──────────────────────│
       │                          │                        │
       │  2. Render Card Fields   │                        │
       │     (PayPal JS SDK)      │                        │
       │                          │                        │
       │  3. Buyer enters card    │                        │
       │     & submits            │                        │
       │ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─>│
       │                          │     (card data goes    │
       │                          │      directly to       │
       │     { state, data }      │      PayPal - PCI)     │
       │ <─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─│
       │                          │                        │
       │  4. createPaymentToken   │                        │
       │     FromSetupToken       │  POST /v3/vault/       │
       │ ────────────────────────>│  payment-tokens        │
       │                          │ ──────────────────────>│
       │                          │                        │
       │  { paymentTokenId,       │  { id, customer,       │
       │    card.brand,           │    payment_source }    │
       │    card.lastDigits }     │                        │
       │ <────────────────────────│ <──────────────────────│
       │                          │                        │
       │  5. Show confirmation    │                        │
       │     "Visa ending 1234    │                        │
       │      saved!"             │                        │
```

Card data **never** touches your server or the Payment App. It goes directly
from the PayPal-hosted card fields to PayPal's servers (PCI compliant).

---

## Prerequisites

Before starting, make sure:

1. **PayPal Payment App is installed and configured** in your Saleor Dashboard
   with valid PayPal credentials (Client ID, Client Secret, Merchant ID).
2. **Advanced Vaulting** is enabled on your PayPal merchant account (confirm
   under REST API Apps > App Feature Options > Vault in the PayPal Developer
   Dashboard).
3. **The buyer is authenticated** on your storefront. You need their
   `saleorUserId` (the Saleor User ID). This flow requires a logged-in user.

---

## Frontend Requirements

You will need the following on your "Saved Payment Methods" or "Add Card" page:

| Requirement | Details |
|---|---|
| **PayPal JS SDK v6** | Load `https://sandbox.paypal.com/web-sdk/v6/core` (sandbox) or `https://www.paypal.com/web-sdk/v6/core` (live). You need the PayPal `clientId` from the Payment App config. |
| **Card field containers** | Three empty `<div>` elements with IDs/selectors for: card number, expiry date, and CVV. These will host PayPal's secure iframes. |
| **A "Save Card" button** | Triggers the submit flow. This is your own UI element. |
| **Loading / error / success states** | Handle the three possible outcomes from `session.submit()`: `succeeded`, `canceled`, `failed`. |
| **tRPC client** | Your storefront needs to call the Payment App's tRPC API. You can use `@trpc/client` or plain `fetch` calls to `{PAYMENT_APP_URL}/api/trpc/customerVault.createSetupToken` and `customerVault.createPaymentTokenFromSetupToken`. |

> **Note:** If you already have CardFields rendering for your checkout page,
> the vault-without-purchase uses a **different** session type. You **cannot**
> reuse a payment session for vaulting. The SDK provides a dedicated method
> called `createCardFieldsSavePaymentSession()` specifically for this.

---

## Step-by-Step Integration

### Step 1: Call `createSetupToken`

This is the first call your storefront makes. It tells PayPal: "a buyer wants to
save a card".

**tRPC endpoint:** `customerVault.createSetupToken` (mutation)

**Input:**

```json
{
  "saleorUserId": "VXNlcjoxOTY0NjUy",
  "paymentMethodType": "card",
  "verificationMethod": "SCA_WHEN_REQUIRED",
  "returnUrl": "https://your-store.com/account/payment-methods",
  "cancelUrl": "https://your-store.com/account/payment-methods"
}
```

| Field | Required | Description |
|---|---|---|
| `saleorUserId` | Yes | The logged-in buyer's Saleor User ID. |
| `paymentMethodType` | No | Defaults to `"card"`. |
| `verificationMethod` | No | `"SCA_WHEN_REQUIRED"` (default) or `"SCA_ALWAYS"`. Controls 3D Secure behavior. |
| `returnUrl` | No | Where to redirect after 3DS challenge completes. Recommended. |
| `cancelUrl` | No | Where to redirect if buyer cancels 3DS challenge. Recommended. |
| `brandName` | No | Your brand name shown during 3DS verification. |

**Response:**

```json
{
  "setupTokenId": "7TY13832WC756832Y",
  "status": "PAYER_ACTION_REQUIRED",
  "approvalUrl": null,
  "customerId": "VXNlcjoxOTY0NjUy",
  "paymentMethodType": "card"
}
```

Hold onto `setupTokenId` -- you will need it in the next steps.

---

### Step 2: Load PayPal SDK and Render Card Fields

After receiving the `setupTokenId`, load the PayPal JS SDK and render the card
fields for vaulting.

You will need to:

1. **Load the PayPal JS SDK v6** script tag (if not already loaded).
2. **Create an SDK instance** with `window.paypal.createInstance()`.
3. **Create a vault session** using `sdk.createCardFieldsSavePaymentSession()`
   -- this is the vault-specific session (NOT the payment session).
4. **Render the card fields** into your container elements using
   `session.render()`.

The card fields are PayPal-hosted secure iframes. Card data entered by the
buyer goes directly to PayPal. Your storefront never sees the raw card numbers.

---

### Step 3: Buyer Enters Card and Submits

When the buyer fills in the card fields and clicks your "Save Card" button:

1. **Call `session.submit(setupTokenId)`** -- pass the `setupTokenId` from
   Step 1.
2. The SDK securely attaches the card data to the setup token on PayPal's
   servers.
3. If 3DS verification is required, the SDK handles the challenge
   automatically (popup or redirect based on your `returnUrl`/`cancelUrl`).
4. The SDK returns a result object: `{ state, data }`.

**Handle the result:**

| `state` | Meaning | What to do |
|---|---|---|
| `"succeeded"` | Card verified and setup token approved. | Proceed to Step 4. `data.vaultSetupToken` contains the token ID. |
| `"canceled"` | Buyer dismissed the 3DS challenge. | Show a message like "Card save was canceled". |
| `"failed"` | Something went wrong. | Show an error. Check `data.message` for details. |

---

### Step 4: Call `createPaymentTokenFromSetupToken`

After `state === "succeeded"`, finalize the vaulting by converting the setup
token into a permanent payment token.

**tRPC endpoint:** `customerVault.createPaymentTokenFromSetupToken` (mutation)

**Input:**

```json
{
  "saleorUserId": "VXNlcjoxOTY0NjUy",
  "setupTokenId": "7TY13832WC756832Y"
}
```

| Field | Required | Description |
|---|---|---|
| `saleorUserId` | Yes | Same Saleor User ID from Step 1. |
| `setupTokenId` | Yes | The `setupTokenId` from Step 1 (or `data.vaultSetupToken` from Step 3). |

**Response:**

```json
{
  "paymentTokenId": "8kk8451t",
  "customerId": "VXNlcjoxOTY0NjUy",
  "paymentMethodType": "card",
  "card": {
    "brand": "VISA",
    "lastDigits": "1234",
    "expiry": "2027-12"
  },
  "paypal": null,
  "venmo": null
}
```

The card is now saved. Show a confirmation to the buyer (e.g., "Visa ending in
1234 has been saved").

---

## Managing Saved Cards

Once cards are saved, you can list and delete them.

### List Saved Payment Methods

**tRPC endpoint:** `customerVault.listSavedPaymentMethods` (query)

**Input:**

```json
{
  "saleorUserId": "VXNlcjoxOTY0NjUy"
}
```

**Response:**

```json
{
  "savedPaymentMethods": [
    {
      "id": "8kk8451t",
      "type": "card",
      "card": {
        "brand": "VISA",
        "lastDigits": "1234",
        "expiry": "2027-12"
      }
    },
    {
      "id": "9mm9562u",
      "type": "card",
      "card": {
        "brand": "MASTERCARD",
        "lastDigits": "5678",
        "expiry": "2026-08"
      }
    }
  ]
}
```

Use this to render saved cards on the "My Payment Methods" page or at checkout.

### Delete a Saved Payment Method

**tRPC endpoint:** `customerVault.deleteSavedPaymentMethod` (mutation)

**Input:**

```json
{
  "saleorUserId": "VXNlcjoxOTY0NjUy",
  "paymentTokenId": "8kk8451t"
}
```

**Response:**

```json
{
  "success": true,
  "deletedPaymentTokenId": "8kk8451t"
}
```

---

## Complete Call Sequence (Summary)

```
Page Load (Saved Payment Methods page)
│
├─ 1. listSavedPaymentMethods({ saleorUserId })
│     → Display existing saved cards
│
│  Buyer clicks "Add New Card"
│
├─ 2. createSetupToken({ saleorUserId, paymentMethodType: "card" })
│     → Receive setupTokenId
│
├─ 3. Load PayPal SDK v6
│     → paypal.createInstance({ clientToken, components: ["card-fields"] })
│     → sdk.createCardFieldsSavePaymentSession()
│     → session.render({ fields: { number, cvv, expirationDate } })
│
│  Buyer fills card fields and clicks "Save Card"
│
├─ 4. session.submit(setupTokenId)
│     → PayPal validates card, runs 3DS if needed
│     → Returns { state: "succeeded", data: { vaultSetupToken } }
│
├─ 5. createPaymentTokenFromSetupToken({ saleorUserId, setupTokenId })
│     → Card is permanently vaulted
│     → Receive { paymentTokenId, card: { brand, lastDigits } }
│
└─ 6. Show confirmation, refresh saved cards list
```

---

## Important Notes

- **Security:** Never expose `paymentTokenId` values directly in client-side
  URLs or logs. The PayPal docs recommend creating your own internal IDs and
  mapping them server-side.
- **One session type per page:** `createCardFieldsSavePaymentSession()` (vault)
  and `createCardFieldsPaymentSession()` (checkout) cannot coexist on the same
  page. Use separate pages for "save a card" and "pay with a card".
- **Authentication:** All tRPC calls require a valid Saleor JWT token and the
  `saleorApiUrl` header. Your tRPC client must be configured to send these.
- **3DS handling:** If you provide `returnUrl` and `cancelUrl` in Step 1, the
  SDK will handle 3DS challenges via redirect. If omitted, it may use a popup.
  Providing URLs is recommended.
- **First-time vs returning buyers:** The Payment App automatically handles
  creating or reusing a PayPal customer ID for the given `saleorUserId`. You
  don't need to manage this mapping yourself.
