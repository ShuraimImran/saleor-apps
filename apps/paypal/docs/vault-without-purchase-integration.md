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
       │     (JWT in header)      │                        │
       │ ────────────────────────>│  Verify user via       │
       │                          │  Saleor `me` query     │
       │                          │                        │
       │                          │  POST /v3/vault/       │
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
       │     (JWT in header)      │  payment-tokens        │
       │ ────────────────────────>│ ──────────────────────>│
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

## Authentication

All vault tRPC endpoints use **storefront token authentication**. This is
different from the App Bridge JWT used by Dashboard-embedded apps.

**How it works:**

1. The buyer logs into your storefront (via Saleor's `tokenCreate` mutation).
2. Your storefront sends the buyer's JWT in every tRPC request.
3. The Payment App calls Saleor's `me` query with that JWT to verify the user.
4. The verified `user_id` from the `me` response is used for all vault
   operations. **You do not send `saleorUserId` in the request body.**

**Required headers on every tRPC call:**

| Header | Value |
|---|---|
| `authorization-bearer` | The buyer's Saleor JWT (from `tokenCreate`) |
| `saleor-api-url` | Your Saleor GraphQL URL (e.g., `https://your-store.saleor.cloud/graphql/`) |
| `Content-Type` | `application/json` (for POST mutations only) |

This means the buyer can only access their own vault. There is no way to pass
a different user's ID to access someone else's saved cards.

---

## Prerequisites

Before starting, make sure:

1. **PayPal Payment App is installed and configured** in your Saleor Dashboard
   with valid PayPal credentials (Client ID, Client Secret, Merchant ID).
2. **Advanced Vaulting** is enabled on your PayPal merchant account (confirm
   under REST API Apps > App Feature Options > Vault in the PayPal Developer
   Dashboard).
3. **The buyer is authenticated** on your storefront. You need their Saleor JWT
   token. This flow requires a logged-in user.

---

## Frontend Requirements

You will need the following on your "Saved Payment Methods" or "Add Card" page:

| Requirement | Details |
|---|---|
| **PayPal JS SDK v6** | Load `https://sandbox.paypal.com/web-sdk/v6/core` (sandbox) or `https://www.paypal.com/web-sdk/v6/core` (live). You need the PayPal `clientId` from the Payment App config. |
| **Card field containers** | Three empty `<div>` elements with IDs/selectors for: card number, expiry date, and CVV. These will host PayPal's secure iframes. |
| **A "Save Card" button** | Triggers the submit flow. This is your own UI element. |
| **Loading / error / success states** | Handle the three possible outcomes from `session.submit()`: `succeeded`, `canceled`, `failed`. |
| **tRPC client or fetch** | Your storefront needs to call the Payment App's tRPC API. Use `@trpc/client`, or plain `fetch` with the correct headers and HTTP method (GET for queries, POST for mutations). |

> **Note:** If you already have CardFields rendering for your checkout page,
> the vault-without-purchase uses a **different** session type. You **cannot**
> reuse a payment session for vaulting. The SDK provides a dedicated method
> called `createCardFieldsSavePaymentSession()` specifically for this.

---

## tRPC HTTP Format

The Payment App uses tRPC v10. The HTTP conventions are:

- **Queries** use `GET` with input as a URL query parameter:
  ```
  GET /api/trpc/customerVault.listSavedPaymentMethods?input={}
  ```
- **Mutations** use `POST` with input as the JSON body:
  ```
  POST /api/trpc/customerVault.createSetupToken
  Body: { "paymentMethodType": "card" }
  ```

If you use `@trpc/client`, this is handled automatically. If you use plain
`fetch`, see the examples below.

---

## Step-by-Step Integration

### Step 1: Call `createSetupToken`

This is the first call your storefront makes. It tells PayPal: "a buyer wants to
save a card".

**tRPC endpoint:** `customerVault.createSetupToken` (mutation - POST)

**Input:**

```json
{
  "paymentMethodType": "card",
  "verificationMethod": "SCA_WHEN_REQUIRED",
  "returnUrl": "https://your-store.com/account/payment-methods",
  "cancelUrl": "https://your-store.com/account/payment-methods"
}
```

| Field | Required | Description |
|---|---|---|
| `paymentMethodType` | No | Defaults to `"card"`. Also supports `"paypal"` and `"venmo"`. |
| `verificationMethod` | No | `"SCA_WHEN_REQUIRED"` (default) or `"SCA_ALWAYS"`. Controls 3D Secure behavior. |
| `returnUrl` | No | Where to redirect after 3DS challenge completes. Recommended. |
| `cancelUrl` | No | Where to redirect if buyer cancels 3DS challenge. Recommended. |
| `brandName` | No | Your brand name shown during 3DS verification. |

> **Note:** `saleorUserId` is **not** in the input. It is extracted from the
> JWT token on the server side.

**Example (plain fetch):**

```javascript
const response = await fetch(
  `${PAYMENT_APP_URL}/api/trpc/customerVault.createSetupToken`,
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "saleor-api-url": "https://your-store.saleor.cloud/graphql/",
      "authorization-bearer": userJwtToken,
    },
    body: JSON.stringify({
      paymentMethodType: "card",
      verificationMethod: "SCA_WHEN_REQUIRED",
    }),
  }
);

const { result } = await response.json();
const { setupTokenId } = result.data;
```

**Response:**

```json
{
  "setupTokenId": "7TY13832WC756832Y",
  "status": "PAYER_ACTION_REQUIRED",
  "approvalUrl": null,
  "customerId": "VXNlcjoy",
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

**tRPC endpoint:** `customerVault.createPaymentTokenFromSetupToken` (mutation - POST)

**Input:**

```json
{
  "setupTokenId": "7TY13832WC756832Y"
}
```

| Field | Required | Description |
|---|---|---|
| `setupTokenId` | Yes | The `setupTokenId` from Step 1 (or `data.vaultSetupToken` from Step 3). |

> **Note:** `saleorUserId` is **not** in the input. It is extracted from the
> JWT token on the server side.

**Example (plain fetch):**

```javascript
const response = await fetch(
  `${PAYMENT_APP_URL}/api/trpc/customerVault.createPaymentTokenFromSetupToken`,
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "saleor-api-url": "https://your-store.saleor.cloud/graphql/",
      "authorization-bearer": userJwtToken,
    },
    body: JSON.stringify({
      setupTokenId: "7TY13832WC756832Y",
    }),
  }
);

const { result } = await response.json();
const { paymentTokenId, card } = result.data;
```

**Response:**

```json
{
  "paymentTokenId": "8kk8451t",
  "customerId": "VXNlcjoy",
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

**tRPC endpoint:** `customerVault.listSavedPaymentMethods` (query - GET)

**Input:** None required. The user is identified from the JWT.

**Example (plain fetch):**

```javascript
const response = await fetch(
  `${PAYMENT_APP_URL}/api/trpc/customerVault.listSavedPaymentMethods?input={}`,
  {
    method: "GET",
    headers: {
      "saleor-api-url": "https://your-store.saleor.cloud/graphql/",
      "authorization-bearer": userJwtToken,
    },
  }
);

const { result } = await response.json();
const { savedPaymentMethods } = result.data;
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

**tRPC endpoint:** `customerVault.deleteSavedPaymentMethod` (mutation - POST)

**Input:**

```json
{
  "paymentTokenId": "8kk8451t"
}
```

**Example (plain fetch):**

```javascript
const response = await fetch(
  `${PAYMENT_APP_URL}/api/trpc/customerVault.deleteSavedPaymentMethod`,
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "saleor-api-url": "https://your-store.saleor.cloud/graphql/",
      "authorization-bearer": userJwtToken,
    },
    body: JSON.stringify({
      paymentTokenId: "8kk8451t",
    }),
  }
);
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
├─ 1. GET  listSavedPaymentMethods  (no input, user from JWT)
│     → Display existing saved cards
│
│  Buyer clicks "Add New Card"
│
├─ 2. POST createSetupToken({ paymentMethodType: "card" })
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
├─ 5. POST createPaymentTokenFromSetupToken({ setupTokenId })
│     → Card is permanently vaulted
│     → Receive { paymentTokenId, card: { brand, lastDigits } }
│
└─ 6. Show confirmation, refresh saved cards list
```

---

## Important Notes

- **Authentication:** All tRPC calls require a valid Saleor user JWT
  (`authorization-bearer` header) and the `saleor-api-url` header. The server
  verifies the user by calling Saleor's `me` query. You do **not** pass
  `saleorUserId` in the request body.
- **Security:** The user ID is derived server-side from the verified JWT. A
  buyer can only access their own vault. There is no way to impersonate
  another user.
- **Security:** Never expose `paymentTokenId` values directly in client-side
  URLs or logs. The PayPal docs recommend creating your own internal IDs and
  mapping them server-side.
- **One session type per page:** `createCardFieldsSavePaymentSession()` (vault)
  and `createCardFieldsPaymentSession()` (checkout) cannot coexist on the same
  page. Use separate pages for "save a card" and "pay with a card".
- **tRPC HTTP methods:** Queries use GET, mutations use POST. If using
  `@trpc/client`, this is handled automatically.
- **CORS:** The Payment App includes CORS headers for cross-origin requests.
  If your storefront runs on a different domain, requests will work.
- **3DS handling:** If you provide `returnUrl` and `cancelUrl` in Step 1, the
  SDK will handle 3DS challenges via redirect. If omitted, it may use a popup.
  Providing URLs is recommended.
- **First-time vs returning buyers:** The Payment App automatically handles
  creating or reusing a PayPal customer ID for the authenticated user. You
  don't need to manage this mapping yourself.
