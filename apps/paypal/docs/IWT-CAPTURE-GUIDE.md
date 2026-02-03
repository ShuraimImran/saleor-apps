# PayPal IWT Capture Guide

This guide explains how to capture API samples and screen recordings for PayPal Integration Wellness Test (IWT) submission.

## Prerequisites

1. **PayPal App** running with `PAYPAL_DEBUG_LOGGING=true` in `.env`
2. **StoreFront** connected to the PayPal sandbox environment
3. **Screen recording software** (OBS, Loom, QuickTime, or browser extension)
4. **Test PayPal sandbox account** credentials

---

## Step 1: Enable Debug Logging

In your PayPal app `.env` file:

```bash
# Enable IWT debug logging
PAYPAL_DEBUG_LOGGING=true

# Optional: Log to a file (easier to capture than console)
PAYPAL_DEBUG_LOG_FILE=/tmp/paypal-iwt.log
```

Restart the app. You'll see full request/response JSON in the console (and file if configured):

```
========== IWT REQUEST ==========
POST https://api-m.sandbox.paypal.com/v2/checkout/orders
Headers: { ... }
Body: { ... }
=================================

========== IWT SUCCESS RESPONSE ==========
Status: 201 Created
PayPal-Debug-Id: abc123xyz
Body: { ... }
==========================================
```

---

## Step 2: Capture Each Flow

### Flow 1: ACDC Buyer-Present Checkout

**What to capture:**
- Screen recording of full checkout flow
- API logs for: Create Order + Capture Order

**Steps:**
1. Start screen recording
2. Add item to cart on StoreFront
3. Go to checkout
4. Select "Credit/Debit Card" payment method
5. Enter test card details:
   - Card: `4032039317984658`
   - Expiry: Any future date
   - CVV: Any 3 digits
6. Complete payment
7. Stop recording

**Expected API calls:**
```
POST /v2/checkout/orders          (Create Order)
POST /v2/checkout/orders/{id}/capture  (Capture Order)
```

---

### Flow 2: Google Pay Buyer-Present Checkout

**What to capture:**
- Screen recording of full checkout flow
- API logs for: Create Order + Capture Order

**Steps:**
1. Start screen recording
2. Add item to cart on StoreFront
3. Go to checkout
4. Select "Google Pay" payment method
5. Complete Google Pay authentication
6. Complete payment
7. Stop recording

**Expected API calls:**
```
POST /v2/checkout/orders          (Create Order)
POST /v2/checkout/orders/{id}/capture  (Capture Order)
```

---

### Flow 3: Apple Pay Buyer-Present Checkout

**What to capture:**
- Screen recording of full checkout flow
- API logs for: Create Order + Capture Order

**Requirements:**
- Safari browser on macOS/iOS
- Apple Pay configured on device

**Steps:**
1. Start screen recording
2. Add item to cart on StoreFront
3. Go to checkout
4. Select "Apple Pay" payment method
5. Complete Apple Pay authentication (Face ID/Touch ID)
6. Complete payment
7. Stop recording

**Expected API calls:**
```
POST /v2/checkout/orders          (Create Order)
POST /v2/checkout/orders/{id}/capture  (Capture Order)
```

---

### Flow 4: Vault Without Purchase

**What to capture:**
- Screen recording of saving card in "My Account"
- API logs for: Create Setup Token + Create Payment Token

**Steps:**
1. Start screen recording
2. Log in to StoreFront
3. Go to "My Account" > "Payment Methods" (or similar)
4. Click "Add Card"
5. Enter test card details:
   - Card: `4032039317984658`
   - Expiry: Any future date
   - CVV: Any 3 digits
6. Save card
7. Stop recording

**Expected API calls:**
```
POST /v3/vault/setup-tokens       (Create Setup Token)
POST /v3/vault/payment-tokens     (Create Payment Token)
```

---

### Flow 5: Vault With Purchase (Save During Checkout)

**What to capture:**
- Screen recording of checkout with "save card" checkbox
- API logs for: Create Order (with vault attributes) + Capture Order

**Steps:**
1. Start screen recording
2. Log in to StoreFront (must be logged in)
3. Add item to cart
4. Go to checkout
5. Select "Credit/Debit Card" payment method
6. Enter test card details
7. **Check "Save card for future purchases"** checkbox
8. Complete payment
9. Stop recording

**Expected API calls:**
```
POST /v2/checkout/orders          (Create Order - with payment_source.card.attributes.vault)
POST /v2/checkout/orders/{id}/capture  (Capture Order - response includes vault info)
```

**Look for in Create Order request:**
```json
{
  "payment_source": {
    "card": {
      "attributes": {
        "vault": { "store_in_vault": "ON_SUCCESS" },
        "customer": { "id": "..." }
      }
    }
  }
}
```

---

### Flow 6: Return Buyer (Pay with Saved Card)

**What to capture:**
- Screen recording of checkout using saved card
- API logs for: Create Order (with vault_id) + Capture Order

**Prerequisites:**
- User must have a saved card from Flow 4 or 5

**Steps:**
1. Start screen recording
2. Log in to StoreFront
3. Add item to cart
4. Go to checkout
5. Select saved card from list
6. Complete payment (may require CVV re-entry)
7. Stop recording

**Expected API calls:**
```
POST /v2/checkout/orders          (Create Order - with payment_source.card.vault_id)
POST /v2/checkout/orders/{id}/capture  (Capture Order)
```

**Look for in Create Order request:**
```json
{
  "payment_source": {
    "card": {
      "vault_id": "8kk41228vp128383f",
      "stored_credential": {
        "payment_initiator": "CUSTOMER",
        "payment_type": "ONE_TIME",
        "usage": "SUBSEQUENT"
      }
    }
  }
}
```

---

## Step 3: Organize Captured Data

For each flow, save:

1. **Screen recording** - `.mp4` or `.mov` file
2. **API Request JSON** - Copy from console `IWT REQUEST` block
3. **API Response JSON** - Copy from console `IWT SUCCESS RESPONSE` block

Name files clearly:
```
ACDC-checkout-request.json
ACDC-checkout-response.json
ACDC-checkout-recording.mp4

vault-without-purchase-setup-token-request.json
vault-without-purchase-setup-token-response.json
vault-without-purchase-payment-token-request.json
vault-without-purchase-payment-token-response.json
vault-without-purchase-recording.mp4
```

---

## Step 4: Disable Debug Logging

After capturing all samples, disable debug logging:

```bash
PAYPAL_DEBUG_LOGGING=false
```

**WARNING:** Never run production with debug logging enabled (PCI compliance).

---

## Test Card Numbers

| Card Type | Number | Use Case |
|---|---|---|
| Visa | `4032039317984658` | Standard successful payment |
| Visa | `4532015112830366` | Alternative test card |
| Mastercard | `5425233430109903` | Standard successful payment |

For 3DS testing, use PayPal sandbox test cards that trigger 3DS challenges.

---

## Troubleshooting

### No logs appearing
- Ensure `PAYPAL_DEBUG_LOGGING=true` is set
- Restart the PayPal app after changing env
- Check you're looking at the correct terminal/log output

### API calls not showing
- Ensure StoreFront is connected to your PayPal app (not production)
- Check network tab in browser to confirm requests are going to your app

### Using file logging (recommended)
If console logs are hard to capture (e.g., Vercel, Docker), use file logging:

```bash
PAYPAL_DEBUG_LOG_FILE=/tmp/paypal-iwt.log
```

Then view logs with:
```bash
# Follow logs in real-time
tail -f /tmp/paypal-iwt.log

# View full log file
cat /tmp/paypal-iwt.log

# Copy specific sections
grep -A 50 "IWT REQUEST" /tmp/paypal-iwt.log
```

### Screen recording tips
- Record at 1080p or higher
- Show the full browser window including URL bar
- Narrate or add captions explaining each step (optional but helpful)
