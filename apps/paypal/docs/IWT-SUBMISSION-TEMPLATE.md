# PayPal IWT Submission

**Partner:** [Your Company Name]
**Integration:** Saleor PayPal Payment App
**Environment:** Sandbox
**Date:** [YYYY-MM-DD]

---

## 1. ACDC (Card Fields) - Buyer Present Checkout

### Screen Recording
- **File:** `ACDC-checkout-recording.mp4`
- **Duration:** [X minutes]
- **Description:** User completes checkout with credit card on StoreFront

### API Sample: Create Order

**Request:**
```http
POST https://api-m.sandbox.paypal.com/v2/checkout/orders
Content-Type: application/json
Authorization: Bearer [REDACTED]
PayPal-Partner-Attribution-Id: [BN_CODE]
PayPal-Auth-Assertion: [REDACTED]
```

```json
[PASTE CREATE ORDER REQUEST BODY HERE]
```

**Response:**
```http
HTTP/1.1 201 Created
PayPal-Debug-Id: [DEBUG_ID]
```

```json
[PASTE CREATE ORDER RESPONSE BODY HERE]
```

### API Sample: Capture Order

**Request:**
```http
POST https://api-m.sandbox.paypal.com/v2/checkout/orders/{ORDER_ID}/capture
Content-Type: application/json
Authorization: Bearer [REDACTED]
PayPal-Partner-Attribution-Id: [BN_CODE]
PayPal-Auth-Assertion: [REDACTED]
```

**Response:**
```http
HTTP/1.1 201 Created
PayPal-Debug-Id: [DEBUG_ID]
```

```json
[PASTE CAPTURE ORDER RESPONSE BODY HERE]
```

---

## 2. Google Pay - Buyer Present Checkout

### Screen Recording
- **File:** `GooglePay-checkout-recording.mp4`
- **Duration:** [X minutes]
- **Description:** User completes checkout with Google Pay on StoreFront

### API Sample: Create Order

**Request:**
```http
POST https://api-m.sandbox.paypal.com/v2/checkout/orders
Content-Type: application/json
Authorization: Bearer [REDACTED]
PayPal-Partner-Attribution-Id: [BN_CODE]
```

```json
[PASTE CREATE ORDER REQUEST BODY HERE]
```

**Response:**
```http
HTTP/1.1 201 Created
PayPal-Debug-Id: [DEBUG_ID]
```

```json
[PASTE CREATE ORDER RESPONSE BODY HERE]
```

### API Sample: Capture Order

**Request:**
```http
POST https://api-m.sandbox.paypal.com/v2/checkout/orders/{ORDER_ID}/capture
```

**Response:**
```json
[PASTE CAPTURE ORDER RESPONSE BODY HERE]
```

---

## 3. Apple Pay - Buyer Present Checkout

### Screen Recording
- **File:** `ApplePay-checkout-recording.mp4`
- **Duration:** [X minutes]
- **Description:** User completes checkout with Apple Pay on Safari

### API Sample: Create Order

**Request:**
```http
POST https://api-m.sandbox.paypal.com/v2/checkout/orders
Content-Type: application/json
Authorization: Bearer [REDACTED]
PayPal-Partner-Attribution-Id: [BN_CODE]
```

```json
[PASTE CREATE ORDER REQUEST BODY HERE]
```

**Response:**
```json
[PASTE CREATE ORDER RESPONSE BODY HERE]
```

### API Sample: Capture Order

**Request:**
```http
POST https://api-m.sandbox.paypal.com/v2/checkout/orders/{ORDER_ID}/capture
```

**Response:**
```json
[PASTE CAPTURE ORDER RESPONSE BODY HERE]
```

---

## 4. ACDC Vaulting - Vault Without Purchase

### Screen Recording
- **File:** `vault-without-purchase-recording.mp4`
- **Duration:** [X minutes]
- **Description:** User saves card in "My Account" without making a purchase

### API Sample: Create Setup Token

**Request:**
```http
POST https://api-m.sandbox.paypal.com/v3/vault/setup-tokens
Content-Type: application/json
Authorization: Bearer [REDACTED]
PayPal-Auth-Assertion: [REDACTED]
```

```json
[PASTE CREATE SETUP TOKEN REQUEST BODY HERE]
```

**Response:**
```http
HTTP/1.1 201 Created
PayPal-Debug-Id: [DEBUG_ID]
```

```json
[PASTE CREATE SETUP TOKEN RESPONSE BODY HERE]
```

### API Sample: Create Payment Token

**Request:**
```http
POST https://api-m.sandbox.paypal.com/v3/vault/payment-tokens
Content-Type: application/json
Authorization: Bearer [REDACTED]
PayPal-Auth-Assertion: [REDACTED]
```

```json
{
  "payment_source": {
    "token": {
      "id": "[SETUP_TOKEN_ID]",
      "type": "SETUP_TOKEN"
    }
  }
}
```

**Response:**
```http
HTTP/1.1 201 Created
PayPal-Debug-Id: [DEBUG_ID]
```

```json
[PASTE CREATE PAYMENT TOKEN RESPONSE BODY HERE]
```

---

## 5. ACDC Vaulting - Vault With Purchase

### Screen Recording
- **File:** `vault-with-purchase-recording.mp4`
- **Duration:** [X minutes]
- **Description:** User checks "save card" during checkout

### API Sample: Create Order (with Vault Attributes)

**Request:**
```http
POST https://api-m.sandbox.paypal.com/v2/checkout/orders
Content-Type: application/json
Authorization: Bearer [REDACTED]
PayPal-Partner-Attribution-Id: [BN_CODE]
PayPal-Auth-Assertion: [REDACTED]
```

```json
[PASTE CREATE ORDER REQUEST BODY HERE - should include payment_source.card.attributes.vault]
```

**Response:**
```json
[PASTE CREATE ORDER RESPONSE BODY HERE]
```

### API Sample: Capture Order (with Vault Response)

**Request:**
```http
POST https://api-m.sandbox.paypal.com/v2/checkout/orders/{ORDER_ID}/capture
```

**Response:**
```json
[PASTE CAPTURE ORDER RESPONSE BODY HERE - should include payment_source.card.attributes.vault with id and status]
```

---

## 6. ACDC Vaulting - Buyer Present Checkout (Return Buyer)

### Screen Recording
- **File:** `return-buyer-checkout-recording.mp4`
- **Duration:** [X minutes]
- **Description:** User pays with previously saved card

### API Sample: Create Order (with Vault ID)

**Request:**
```http
POST https://api-m.sandbox.paypal.com/v2/checkout/orders
Content-Type: application/json
Authorization: Bearer [REDACTED]
PayPal-Partner-Attribution-Id: [BN_CODE]
PayPal-Auth-Assertion: [REDACTED]
```

```json
[PASTE CREATE ORDER REQUEST BODY HERE - should include payment_source.card.vault_id and stored_credential]
```

**Key fields to verify:**
```json
{
  "payment_source": {
    "card": {
      "vault_id": "[PAYMENT_TOKEN_ID]",
      "stored_credential": {
        "payment_initiator": "CUSTOMER",
        "payment_type": "ONE_TIME",
        "usage": "SUBSEQUENT"
      }
    }
  }
}
```

**Response:**
```json
[PASTE CREATE ORDER RESPONSE BODY HERE]
```

### API Sample: Capture Order

**Request:**
```http
POST https://api-m.sandbox.paypal.com/v2/checkout/orders/{ORDER_ID}/capture
```

**Response:**
```json
[PASTE CAPTURE ORDER RESPONSE BODY HERE]
```

---

## 7. ACDC Vaulting - Buyer Not Present (MIT) [Optional]

> **Note:** MIT flow is only required for subscription/recurring use cases. Skip if not applicable.

### API Sample: Create Order (Merchant Initiated)

**Request:**
```http
POST https://api-m.sandbox.paypal.com/v2/checkout/orders
Content-Type: application/json
Authorization: Bearer [REDACTED]
PayPal-Partner-Attribution-Id: [BN_CODE]
PayPal-Auth-Assertion: [REDACTED]
```

```json
[PASTE CREATE ORDER REQUEST BODY HERE - should include payment_source.card.vault_id with MERCHANT initiator]
```

**Key fields to verify:**
```json
{
  "payment_source": {
    "card": {
      "vault_id": "[PAYMENT_TOKEN_ID]",
      "stored_credential": {
        "payment_initiator": "MERCHANT",
        "payment_type": "UNSCHEDULED",
        "usage": "SUBSEQUENT"
      }
    }
  }
}
```

**Response:**
```json
[PASTE CREATE ORDER RESPONSE BODY HERE - order should be COMPLETED automatically]
```

---

## Summary Checklist

| Flow | API Samples | Screen Recording | Status |
|---|---|---|---|
| ACDC Checkout | [ ] | [ ] | |
| Google Pay Checkout | [ ] | [ ] | |
| Apple Pay Checkout | [ ] | [ ] | |
| Vault Without Purchase | [ ] | [ ] | |
| Vault With Purchase | [ ] | [ ] | |
| Return Buyer (CIT) | [ ] | [ ] | |
| Buyer Not Present (MIT) | [ ] | N/A | |

---

## File Manifest

```
IWT-Submission/
├── ACDC/
│   ├── ACDC-checkout-recording.mp4
│   ├── create-order-request.json
│   ├── create-order-response.json
│   ├── capture-order-request.json
│   └── capture-order-response.json
├── GooglePay/
│   ├── GooglePay-checkout-recording.mp4
│   ├── create-order-request.json
│   ├── create-order-response.json
│   ├── capture-order-request.json
│   └── capture-order-response.json
├── ApplePay/
│   ├── ApplePay-checkout-recording.mp4
│   ├── create-order-request.json
│   ├── create-order-response.json
│   ├── capture-order-request.json
│   └── capture-order-response.json
├── Vaulting/
│   ├── vault-without-purchase/
│   │   ├── recording.mp4
│   │   ├── setup-token-request.json
│   │   ├── setup-token-response.json
│   │   ├── payment-token-request.json
│   │   └── payment-token-response.json
│   ├── vault-with-purchase/
│   │   ├── recording.mp4
│   │   ├── create-order-request.json
│   │   ├── create-order-response.json
│   │   ├── capture-order-request.json
│   │   └── capture-order-response.json
│   └── return-buyer/
│       ├── recording.mp4
│       ├── create-order-request.json
│       ├── create-order-response.json
│       ├── capture-order-request.json
│       └── capture-order-response.json
└── IWT-SUBMISSION-TEMPLATE.md (this file, filled in)
```
