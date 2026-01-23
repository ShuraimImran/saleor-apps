# Frontend: PayPal Vaulting Integration with Saleor

## Overview

Implement frontend support for PayPal card vaulting, integrating PayPal JS SDK with Saleor's GraphQL payment flow. This enables customers to save payment methods during checkout and use saved cards for future purchases.

**Scope:** ACDC Card Vaulting (Phase 1)

---

## PayPal JS SDK Integration

The storefront must load and configure PayPal's JavaScript SDK to render payment components securely. Card data is captured by PayPal's hosted fields (PCI compliant - card data never touches your servers).

### Script Configuration

```html
<script
  src="https://www.paypal.com/sdk/js?client-id={PARTNER_CLIENT_ID}&merchant-id={MERCHANT_ID}&components=buttons,card-fields&intent=capture&currency=USD"
  data-partner-attribution-id="{BN_CODE}"
  data-user-id-token="{USER_ID_TOKEN}"
></script>
```

**Parameters:**
- `client-id`: Partner's PayPal Client ID (from `paypalClientId` in response)
- `merchant-id`: Merchant's PayPal Merchant ID (from `merchantId` in response)
- `components`: `buttons,card-fields` for ACDC
- `intent`: Match the Saleor action type (`capture` for CHARGE, `authorize` for AUTHORIZE)
- `data-partner-attribution-id`: BN Code for partner attribution
- `data-user-id-token`: User ID Token for vaulting (from `userIdToken` in response)

---

## User ID Token Generation

For vaulting to work, the frontend must obtain a user ID token from the backend and pass it to the JS SDK. This token identifies the customer for vault operations.

**Flow:**
1. Frontend calls Saleor `paymentGatewayInitialize` mutation with `saleorUserId`
2. Backend returns `userIdToken` in response (for logged-in users with vaulting enabled)
3. Frontend passes token to JS SDK via `data-user-id-token` attribute

---

## Vaulting UI Requirements

### Flow 1: Save During Purchase (New Card)

**UI Components Needed:**
- Checkbox: "Save this card for future purchases"
- Only visible for logged-in customers
- Positioned below the card fields

**Implementation:**
1. Render PayPal card fields using JS SDK
2. Add save card checkbox (your own UI element)
3. On form submit, pass the checkbox value through Saleor

**Saleor GraphQL Call:**

```graphql
mutation {
  transactionInitialize(
    id: "checkout-id"
    paymentGateway: {
      id: "paypal-app-id"
      data: {
        savePaymentMethod: true
        saleorUserId: "user-123"  # Required for vaulting
      }
    }
  ) {
    transaction {
      id
      status
    }
    data
    errors {
      field
      message
    }
  }
}
```

---

### Flow 2: Return Buyer (Saved Cards)

#### Step 1: Fetch Saved Cards & Configuration

```graphql
mutation {
  paymentGatewayInitialize(
    id: "checkout-id"
    paymentGateways: [{
      id: "paypal-app-id"
      data: {
        saleorUserId: "user-123"  # Required to fetch saved cards
      }
    }]
  ) {
    gatewayConfigs {
      id
      data
      errors {
        field
        message
      }
    }
  }
}
```

**Response Data Structure:**

```json
{
  "paypalClientId": "partner-client-id",
  "merchantClientId": "merchant-client-id",
  "merchantId": "MERCHANT_PAYPAL_ID",
  "paymentMethodReadiness": {
    "applePay": true,
    "googlePay": true,
    "paypalButtons": true,
    "advancedCardProcessing": true,
    "vaulting": true
  },
  "savedPaymentMethods": [
    {
      "id": "8kk8451t",
      "type": "card",
      "card": {
        "brand": "VISA",
        "lastDigits": "7704",
        "expiry": "12/2027"
      }
    },
    {
      "id": "9mm5623r",
      "type": "card",
      "card": {
        "brand": "MASTERCARD",
        "lastDigits": "4444",
        "expiry": "06/2026"
      }
    }
  ],
  "userIdToken": "eyJhbGciOiJSUzI1NiIs..."
}
```

**Response Fields:**
- `paypalClientId`: Partner's PayPal Client ID for JS SDK
- `merchantId`: Merchant's PayPal Merchant ID for JS SDK
- `paymentMethodReadiness`: Object indicating which payment methods are available
- `savedPaymentMethods`: Array of saved cards (when `saleorUserId` provided and vaulting enabled)
- `userIdToken`: JWT token for JS SDK `data-user-id-token` attribute

#### Step 2: Display Saved Cards UI

- Show a list of saved cards with brand icon, last 4 digits, and expiry
- Radio button or selectable card component for each
- "Use a different card" option to show card fields

**Example UI:**
```
[ ] VISA **** 7704 (Expires 12/2027)
[ ] MASTERCARD **** 4444 (Expires 06/2026)
[ ] Use a different card
```

#### Step 3: Pay with Saved Card

```graphql
mutation {
  transactionInitialize(
    id: "checkout-id"
    paymentGateway: {
      id: "paypal-app-id"
      data: {
        vaultId: "8kk8451t"  # The 'id' from savedPaymentMethods
      }
    }
  ) {
    transaction {
      id
      status
    }
    data
    errors {
      field
      message
    }
  }
}
```

**Note:** Use the `id` field from `savedPaymentMethods` as the `vaultId` in the request.

**Response Data Structure for transactionInitialize:**

```json
{
  "transaction": {
    "id": "txn-123",
    "status": "PENDING"
  },
  "data": {
    "paypal_order_id": "5O190127TN364715T",
    "environment": "SANDBOX",
    "vaulting": {
      "enabled": true,
      "customerId": "cust_abc123",
      "isReturnBuyer": true
    }
  }
}
```

**Response Fields:**
- `paypal_order_id`: PayPal order ID (use for JS SDK callbacks)
- `environment`: PayPal environment ("SANDBOX" or "LIVE")
- `vaulting.enabled`: Whether vaulting is active for this transaction
- `vaulting.customerId`: PayPal customer ID (if vaulting enabled)
- `vaulting.isReturnBuyer`: `true` if using a saved card (`vaultId` provided)

---

### Flow 3: Return Buyer Adding New Card

When the customer has saved cards but selects "Use a different card":

1. Show PayPal card fields (same as new customer)
2. Show "Save this card" checkbox
3. Pass `savePaymentMethod: true` and `saleorUserId` if checked

```graphql
mutation {
  transactionInitialize(
    id: "checkout-id"
    paymentGateway: {
      id: "paypal-app-id"
      data: {
        savePaymentMethod: true
        saleorUserId: "user-123"
      }
    }
  ) {
    transaction {
      id
      status
    }
    data
    errors {
      field
      message
    }
  }
}
```

---

## PayPal JS SDK Card Fields Implementation

### HTML Container

```html
<div id="card-name-field-container"></div>
<div id="card-number-field-container"></div>
<div id="card-expiry-field-container"></div>
<div id="card-cvv-field-container"></div>

<label>
  <input type="checkbox" id="save-card-checkbox" />
  Save this card for future purchases
</label>

<button id="card-field-submit-button">Pay</button>
```

### JS SDK Initialization

```javascript
// Initialize card fields
const cardFields = paypal.CardFields({
  createOrder: async () => {
    // Call Saleor to create order via transactionInitialize
    const response = await saleorTransactionInitialize({
      savePaymentMethod: document.getElementById('save-card-checkbox').checked,
      saleorUserId: currentUser.id  // Pass logged-in user ID
    });

    // Return the PayPal order ID from response.data.paypal_order_id
    return response.data.paypal_order_id;
  },

  onApprove: async (data) => {
    // Order approved, capture/authorize through Saleor
    const result = await saleorTransactionProcess(data.orderID);
    // Show success
  },

  onError: (err) => {
    // Handle errors
    console.error('PayPal CardFields error:', err);
  }
});

// Render individual fields
cardFields.NameField().render("#card-name-field-container");
cardFields.NumberField().render("#card-number-field-container");
cardFields.ExpiryField().render("#card-expiry-field-container");
cardFields.CVVField().render("#card-cvv-field-container");

// Submit handler
document.getElementById("card-field-submit-button").addEventListener("click", () => {
  cardFields.submit();
});
```

---

## Key Requirements

| Requirement | Value | Notes |
|-------------|-------|-------|
| `saleorUserId` required for vaulting | Yes | Must be passed in both initialize calls |
| `userIdToken` usage | JS SDK `data-user-id-token` | Enables vaulted button display |
| Saved card field name | `id` | Use as `vaultId` in transactionInitialize |
| Card details structure | Nested under `card` object | `{ id, type, card: { brand, lastDigits, expiry } }` |
| Guest checkout | No vaulting | Don't show save checkbox |
| `merchantInitiated` for MIT | `true` | Set when charging without buyer presence |
| Vault Without Purchase | tRPC endpoints | Use `createSetupToken` + `createPaymentTokenFromSetupToken` |

---

## Error Handling

Handle these scenarios gracefully:

1. **Vaulting not enabled for merchant**: `paymentMethodReadiness.vaulting === false`
   - Don't show save checkbox
   - Don't fetch saved cards

2. **No saved cards**: `savedPaymentMethods` is empty or undefined
   - Show card fields directly

3. **User not logged in**: No `saleorUserId` available
   - Don't show save checkbox
   - Proceed as guest checkout

4. **Card vaulting fails**: Backend logs warning, payment still succeeds
   - Show success to user
   - Card won't be saved for future

5. **Setup token not approved (Vault Without Purchase)**:
   - Error code: `PRECONDITION_FAILED`
   - Message: "Setup token is not approved or has already been used"
   - User must re-enter card details

6. **Customer vault mapping not found**:
   - Error code: `NOT_FOUND`
   - Message: "Customer vault mapping not found. Did you call createSetupToken first?"
   - Ensure `createSetupToken` is called before `createPaymentTokenFromSetupToken`

7. **MIT transaction fails**:
   - Common reasons: Card expired, insufficient funds, card blocked
   - Display appropriate error message to merchant/admin
   - Consider notifying customer to update payment method

---

## Flow 4: Vault Without Purchase (Save for Later)

This flow allows customers to save a card without making a purchase (e.g., "My Account" > "Payment Methods" > "Add Card").

### Step 1: Create Setup Token

Call the tRPC endpoint to create a setup token:

```typescript
// Using tRPC client
const result = await trpcClient.customerVault.createSetupToken.mutate({
  saleorUserId: "user-123",  // Required: Saleor user ID
  returnUrl: "https://store.example.com/account/payment-methods",  // Optional
  cancelUrl: "https://store.example.com/account/payment-methods",  // Optional
  brandName: "My Store",  // Optional: Brand name for 3DS verification
  verificationMethod: "SCA_WHEN_REQUIRED",  // Optional: "SCA_WHEN_REQUIRED" | "SCA_ALWAYS"
});

// Response:
// {
//   setupTokenId: "5C991763SB123456Y",
//   status: "PAYER_ACTION_REQUIRED",
//   approvalUrl: "https://www.paypal.com/...",  // Optional redirect URL
//   customerId: "cust_abc123"  // PayPal customer ID
// }
```

### Step 2: Render PayPal Card Fields with Setup Token

```javascript
const cardFields = paypal.CardFields({
  createVaultSetupToken: async () => {
    // Return the setup token ID from Step 1
    return setupTokenResult.setupTokenId;
  },

  onApprove: async (data) => {
    // Setup token approved, create payment token to complete vaulting
    console.log('Setup token approved:', data.vaultSetupToken);
    await completeVaulting(data.vaultSetupToken);
  },

  onError: (err) => {
    console.error('CardFields error:', err);
  }
});

// Render card fields
cardFields.NameField().render("#card-name-field-container");
cardFields.NumberField().render("#card-number-field-container");
cardFields.ExpiryField().render("#card-expiry-field-container");
cardFields.CVVField().render("#card-cvv-field-container");
```

### Step 3: Create Payment Token from Approved Setup Token

After the customer enters card details and the setup token is approved:

```typescript
// Complete the vaulting process
const paymentToken = await trpcClient.customerVault.createPaymentTokenFromSetupToken.mutate({
  saleorUserId: "user-123",
  setupTokenId: "5C991763SB123456Y",  // From Step 1
});

// Response:
// {
//   paymentTokenId: "8kk8451t",  // This is the vault_id for future payments
//   customerId: "cust_abc123",
//   card: {
//     brand: "VISA",
//     lastDigits: "7704",
//     expiry: "12/2027"
//   }
// }
```

---

## Flow 5: Merchant-Initiated Transactions (MIT) - Buyer Not Present

For scenarios where the merchant needs to charge a saved card without buyer interaction (subscriptions, delayed charges, reorders):

```graphql
mutation {
  transactionInitialize(
    id: "checkout-id"
    paymentGateway: {
      id: "paypal-app-id"
      data: {
        vaultId: "8kk8451t"        # Required: Saved payment method ID
        merchantInitiated: true    # Required: Indicates MIT (Buyer Not Present)
      }
    }
  ) {
    transaction {
      id
      status
    }
    data
    errors {
      field
      message
    }
  }
}
```

**Important Notes:**
- `merchantInitiated: true` signals that this is a Merchant-Initiated Transaction
- The backend automatically adds `stored_credential` with:
  - `payment_initiator: "MERCHANT"`
  - `payment_type: "UNSCHEDULED"`
  - `usage: "SUBSEQUENT"`
- This flow does NOT require buyer interaction or 3DS verification
- Common use cases: subscriptions, installments, delayed charges, reorders

---

## tRPC Endpoints Reference

The PayPal app exposes these tRPC endpoints for vaulting operations:

| Endpoint | Description |
|----------|-------------|
| `customerVault.listSavedPaymentMethods` | List saved cards for a customer |
| `customerVault.deleteSavedPaymentMethod` | Delete a saved card |
| `customerVault.createSetupToken` | Create setup token for vault-without-purchase |
| `customerVault.createPaymentTokenFromSetupToken` | Complete vaulting from approved setup token |

### List Saved Payment Methods

```typescript
const result = await trpcClient.customerVault.listSavedPaymentMethods.query({
  saleorUserId: "user-123",
});

// Response:
// {
//   savedPaymentMethods: [
//     {
//       id: "8kk8451t",
//       type: "card",
//       card: {
//         brand: "VISA",
//         lastDigits: "7704",
//         expiry: "12/2027"
//       }
//     }
//   ]
// }
```

### Delete Saved Payment Method

```typescript
const result = await trpcClient.customerVault.deleteSavedPaymentMethod.mutate({
  saleorUserId: "user-123",
  paymentTokenId: "8kk8451t",  // The 'id' from savedPaymentMethods
});

// Response:
// {
//   success: true,
//   deletedPaymentTokenId: "8kk8451t"
// }
```

---

## Complete Flow Diagram (Updated)

```
Guest User:
  paymentGatewayInitialize (no saleorUserId)
    -> Returns: paypalClientId, merchantId, paymentMethodReadiness
    -> No userIdToken, no savedPaymentMethods
    -> Show card fields only

Logged-in User (First Purchase - Save During Purchase):
  paymentGatewayInitialize (with saleorUserId)
    -> Returns: paypalClientId, merchantId, paymentMethodReadiness, userIdToken
    -> savedPaymentMethods = [] (empty)
    -> Show card fields + "Save card" checkbox

  transactionInitialize (savePaymentMethod: true, saleorUserId)
    -> Card is vaulted on successful payment

Logged-in User (Return Buyer - Buyer Present):
  paymentGatewayInitialize (with saleorUserId)
    -> Returns: paypalClientId, merchantId, paymentMethodReadiness, userIdToken, savedPaymentMethods
    -> Show saved cards list + "Use different card" option

  transactionInitialize (vaultId: "xxx")
    -> Pay with saved card (buyer present, 3DS if required)

Logged-in User (Vault Without Purchase - Save for Later):
  createSetupToken (saleorUserId)
    -> Returns: setupTokenId, customerId
    -> Render PayPal Card Fields with setup token

  createPaymentTokenFromSetupToken (saleorUserId, setupTokenId)
    -> Card is vaulted without making a purchase

Merchant-Initiated Transaction (Buyer Not Present):
  transactionInitialize (vaultId: "xxx", merchantInitiated: true)
    -> Charge saved card without buyer interaction
    -> No 3DS verification required
```

---

## References

- [IWT_REQUIREMENTS_ANALYSIS.md](./IWT_REQUIREMENTS_ANALYSIS.md) - IWT certification requirements
- [PayPal JS SDK Documentation](https://developer.paypal.com/sdk/js/)
- [PayPal Card Fields Integration](https://developer.paypal.com/docs/checkout/advanced/integrate/)
- [PayPal Vaulting API](https://developer.paypal.com/docs/api/payment-tokens/v3/)
