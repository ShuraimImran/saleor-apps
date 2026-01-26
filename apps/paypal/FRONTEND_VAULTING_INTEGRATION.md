# Frontend: PayPal Vaulting Integration with Saleor

## Overview

Implement frontend support for PayPal payment method vaulting, integrating PayPal JS SDK with Saleor's GraphQL payment flow. This enables customers to save payment methods during checkout and use saved methods for future purchases.

**Scope:**
- Phase 1: ACDC Card Vaulting
- Phase 2: PayPal Wallet, Venmo, Apple Pay Vaulting

---

## PayPal JS SDK Integration

The storefront must load and configure PayPal's JavaScript SDK to render payment components securely.

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
- `components`: `buttons,card-fields` (add `applepay,googlepay` as needed)
- `intent`: Match the Saleor action type (`capture` for CHARGE, `authorize` for AUTHORIZE)
- `data-partner-attribution-id`: BN Code for partner attribution
- `data-user-id-token`: **CRITICAL for Phase 2** - User ID Token for vaulting (from `userIdToken` in response)

> **IWT Requirement (Page 15):** The JS SDK script tag's `data-user-id-token` attribute must be populated with a user ID token for buyers with a vaulted branded payment method (PayPal/Venmo).

---

## User ID Token Generation

For vaulting to work, the frontend must obtain a user ID token from the backend and pass it to the JS SDK. This token identifies the customer for vault operations.

**Flow:**
1. Frontend calls Saleor `paymentGatewayInitialize` mutation with `saleorUserId`
2. Backend returns `userIdToken` in response (for logged-in users with vaulting enabled)
3. Frontend passes token to JS SDK via `data-user-id-token` attribute

---

## Response Data Structure

### paymentGatewayInitialize Response

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
      "id": "9pp7834m",
      "type": "paypal",
      "paypal": {
        "email": "buyer@example.com",
        "name": "John Doe"
      }
    },
    {
      "id": "2vv9182k",
      "type": "venmo",
      "venmo": {
        "email": "buyer@venmo.com",
        "userName": "@johndoe",
        "name": "John Doe"
      }
    },
    {
      "id": "4aa3921x",
      "type": "apple_pay",
      "applePay": {
        "brand": "VISA",
        "lastDigits": "1234",
        "expiry": "03/2028",
        "cardType": "CREDIT",
        "email": "buyer@icloud.com",
        "name": "John Doe"
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
- `savedPaymentMethods`: Array of saved payment methods (cards, PayPal wallets, Venmo, Apple Pay)
- `userIdToken`: JWT token for JS SDK `data-user-id-token` attribute

---

# Phase 1: ACDC Card Vaulting

## Flow 1: Save Card During Purchase

**UI Components Needed:**
- Checkbox: "Save this card for future purchases"
- Only visible for logged-in customers
- Positioned below the card fields

**Saleor GraphQL Call:**

```graphql
mutation {
  transactionInitialize(
    id: "checkout-id"
    paymentGateway: {
      id: "paypal-app-id"
      data: {
        paymentMethodType: "card"
        savePaymentMethod: true
        saleorUserId: "user-123"
      }
    }
  ) {
    transaction { id status }
    data
    errors { field message }
  }
}
```

## Flow 2: Return Buyer - Pay with Saved Card

```graphql
mutation {
  transactionInitialize(
    id: "checkout-id"
    paymentGateway: {
      id: "paypal-app-id"
      data: {
        paymentMethodType: "card"
        vaultId: "8kk8451t"
      }
    }
  ) {
    transaction { id status }
    data
    errors { field message }
  }
}
```

## Flow 3: MIT - Charge Saved Card Without Buyer

```graphql
mutation {
  transactionInitialize(
    id: "checkout-id"
    paymentGateway: {
      id: "paypal-app-id"
      data: {
        paymentMethodType: "card"
        vaultId: "8kk8451t"
        merchantInitiated: true
      }
    }
  ) {
    transaction { id status }
    data
    errors { field message }
  }
}
```

---

# Phase 2: PayPal Wallet Vaulting

> **IWT Requirement (Page 15):** Buyers are presented the option to vault their PayPal wallet during checkout. Buyers with a vaulted PayPal wallet are shown the one-click return-buyer checkout flow.

## Flow 1: Vault PayPal Wallet During Purchase

When buyer clicks PayPal button and completes checkout, they can save their PayPal account.

**Frontend Implementation:**

```javascript
paypal.Buttons({
  // Enable vaulting in the button configuration
  createOrder: async () => {
    const response = await saleorTransactionInitialize({
      paymentMethodType: "paypal",
      savePaymentMethod: true,  // Save PayPal wallet
      saleorUserId: currentUser.id
    });
    return response.data.paypal_order_id;
  },

  onApprove: async (data) => {
    // Complete the payment
    await saleorTransactionProcess(data.orderID);
  }
}).render('#paypal-button-container');
```

**Saleor GraphQL Call:**

```graphql
mutation {
  transactionInitialize(
    id: "checkout-id"
    paymentGateway: {
      id: "paypal-app-id"
      data: {
        paymentMethodType: "paypal"
        savePaymentMethod: true
        saleorUserId: "user-123"
      }
    }
  ) {
    transaction { id status }
    data
    errors { field message }
  }
}
```

## Flow 2: Return Buyer - One-Click PayPal Checkout

> **IWT Requirement (Page 15):** Buyers that have a vaulted PayPal or Venmo payment method are shown their vaulted payment method on the rendered PayPal or Venmo buttons.

When `data-user-id-token` is set and buyer has saved PayPal wallet, the PayPal button shows their saved account for one-click checkout.

**Frontend Implementation:**

```javascript
// The JS SDK automatically shows vaulted payment when data-user-id-token is set
// No additional code needed - just ensure userIdToken is in script tag

paypal.Buttons({
  createOrder: async () => {
    const response = await saleorTransactionInitialize({
      paymentMethodType: "paypal",
      vaultId: "9pp7834m"  // Saved PayPal wallet ID
    });
    return response.data.paypal_order_id;
  },

  onApprove: async (data) => {
    await saleorTransactionProcess(data.orderID);
  }
}).render('#paypal-button-container');
```

**Saleor GraphQL Call:**

```graphql
mutation {
  transactionInitialize(
    id: "checkout-id"
    paymentGateway: {
      id: "paypal-app-id"
      data: {
        paymentMethodType: "paypal"
        vaultId: "9pp7834m"
      }
    }
  ) {
    transaction { id status }
    data
    errors { field message }
  }
}
```

## Flow 3: Vault PayPal Without Purchase (RBM)

> **IWT Requirement (Page 15):** Buyers are able to vault their PayPal wallet without placing an order.

For "My Account" > "Payment Methods" > "Add PayPal":

### Step 1: Create Setup Token

```typescript
const result = await trpcClient.customerVault.createSetupToken.mutate({
  saleorUserId: "user-123",
  paymentMethodType: "paypal",  // Specify PayPal wallet
  returnUrl: "https://store.example.com/account/payment-methods",
  cancelUrl: "https://store.example.com/account/payment-methods",
  brandName: "My Store",
  description: "Save PayPal for future purchases",
  usageType: "MERCHANT"
});

// Response:
// {
//   setupTokenId: "5C991763SB123456Y",
//   status: "PAYER_ACTION_REQUIRED",
//   approvalUrl: "https://www.paypal.com/...",  // Redirect buyer here
//   customerId: "cust_abc123",
//   paymentMethodType: "paypal"
// }
```

### Step 2: Redirect to PayPal for Approval

```javascript
// Redirect buyer to PayPal approval page
window.location.href = result.approvalUrl;

// Or use popup
window.open(result.approvalUrl, 'paypal-approval', 'width=500,height=600');
```

### Step 3: After Approval - Create Payment Token

```typescript
// Called after buyer returns from PayPal approval
const paymentToken = await trpcClient.customerVault.createPaymentTokenFromSetupToken.mutate({
  saleorUserId: "user-123",
  setupTokenId: "5C991763SB123456Y"
});

// Response:
// {
//   paymentTokenId: "9pp7834m",  // Use as vault_id for future payments
//   customerId: "cust_abc123",
//   paymentMethodType: "paypal",
//   paypal: {
//     email: "buyer@example.com",
//     name: "John Doe"
//   }
// }
```

## Flow 4: MIT - PayPal Buyer Not Present

> **IWT Requirement (Page 15):** Buyer-not-present transactions can be processed using the buyer's vaulted PayPal wallet.

```graphql
mutation {
  transactionInitialize(
    id: "checkout-id"
    paymentGateway: {
      id: "paypal-app-id"
      data: {
        paymentMethodType: "paypal"
        vaultId: "9pp7834m"
        merchantInitiated: true
      }
    }
  ) {
    transaction { id status }
    data
    errors { field message }
  }
}
```

---

# Phase 2: Venmo Vaulting

> **IWT Requirement (Page 15):** Buyers are presented the option to vault Venmo as a payment method during checkout. Buyers with vaulted Venmo wallets are shown the one-click return-buyer checkout flow.

## Flow 1: Vault Venmo During Purchase

**Frontend Implementation:**

```javascript
paypal.Buttons({
  fundingSource: paypal.FUNDING.VENMO,

  createOrder: async () => {
    const response = await saleorTransactionInitialize({
      paymentMethodType: "venmo",
      savePaymentMethod: true,
      saleorUserId: currentUser.id
    });
    return response.data.paypal_order_id;
  },

  onApprove: async (data) => {
    await saleorTransactionProcess(data.orderID);
  }
}).render('#venmo-button-container');
```

**Saleor GraphQL Call:**

```graphql
mutation {
  transactionInitialize(
    id: "checkout-id"
    paymentGateway: {
      id: "paypal-app-id"
      data: {
        paymentMethodType: "venmo"
        savePaymentMethod: true
        saleorUserId: "user-123"
      }
    }
  ) {
    transaction { id status }
    data
    errors { field message }
  }
}
```

## Flow 2: Return Buyer - One-Click Venmo

Similar to PayPal, when `data-user-id-token` is set, the Venmo button shows saved account.

```graphql
mutation {
  transactionInitialize(
    id: "checkout-id"
    paymentGateway: {
      id: "paypal-app-id"
      data: {
        paymentMethodType: "venmo"
        vaultId: "2vv9182k"
      }
    }
  ) {
    transaction { id status }
    data
    errors { field message }
  }
}
```

## Flow 3: Vault Venmo Without Purchase (RBM)

```typescript
const result = await trpcClient.customerVault.createSetupToken.mutate({
  saleorUserId: "user-123",
  paymentMethodType: "venmo",
  returnUrl: "https://store.example.com/account/payment-methods",
  cancelUrl: "https://store.example.com/account/payment-methods",
  brandName: "My Store",
  description: "Save Venmo for future purchases",
  usageType: "MERCHANT"
});

// Redirect to Venmo approval, then create payment token (same as PayPal flow)
```

> **Note:** Venmo is **buyer-present only** per FSS. MIT (merchantInitiated: true) is NOT supported for Venmo.

---

# Phase 2: Apple Pay Vaulting

> **Note:** Apple Pay vaulting is primarily for recurring/unscheduled payments. Vault-without-purchase is NOT typically supported for Apple Pay.

## Flow 1: Vault Apple Pay During Purchase

**Frontend Implementation:**

```javascript
paypal.Applepay().config({
  // Apple Pay configuration
}).then(applePayConfig => {
  const applePaySession = new ApplePaySession(3, {
    // Apple Pay payment request
  });

  applePaySession.onpaymentauthorized = async (event) => {
    const response = await saleorTransactionInitialize({
      paymentMethodType: "apple_pay",
      savePaymentMethod: true,
      saleorUserId: currentUser.id,
      // Include Apple Pay token data
    });

    // Complete payment
  };
});
```

**Saleor GraphQL Call:**

```graphql
mutation {
  transactionInitialize(
    id: "checkout-id"
    paymentGateway: {
      id: "paypal-app-id"
      data: {
        paymentMethodType: "apple_pay"
        savePaymentMethod: true
        saleorUserId: "user-123"
      }
    }
  ) {
    transaction { id status }
    data
    errors { field message }
  }
}
```

## Flow 2: Return Buyer - Pay with Saved Apple Pay

```graphql
mutation {
  transactionInitialize(
    id: "checkout-id"
    paymentGateway: {
      id: "paypal-app-id"
      data: {
        paymentMethodType: "apple_pay"
        vaultId: "4aa3921x"
      }
    }
  ) {
    transaction { id status }
    data
    errors { field message }
  }
}
```

## Flow 3: MIT - Apple Pay Recurring/Unscheduled

```graphql
mutation {
  transactionInitialize(
    id: "checkout-id"
    paymentGateway: {
      id: "paypal-app-id"
      data: {
        paymentMethodType: "apple_pay"
        vaultId: "4aa3921x"
        merchantInitiated: true
      }
    }
  ) {
    transaction { id status }
    data
    errors { field message }
  }
}
```

---

# Saved Payment Methods UI

## Displaying Saved Payment Methods

Based on `savedPaymentMethods` array from `paymentGatewayInitialize`:

```jsx
function SavedPaymentMethodsList({ savedPaymentMethods, onSelect }) {
  return (
    <div className="saved-payment-methods">
      {savedPaymentMethods.map(method => {
        switch (method.type) {
          case 'card':
            return (
              <PaymentMethodOption
                key={method.id}
                icon={<CardIcon brand={method.card.brand} />}
                label={`${method.card.brand} •••• ${method.card.lastDigits}`}
                subtitle={`Expires ${method.card.expiry}`}
                onClick={() => onSelect(method.id, 'card')}
              />
            );

          case 'paypal':
            return (
              <PaymentMethodOption
                key={method.id}
                icon={<PayPalIcon />}
                label="PayPal"
                subtitle={method.paypal.email}
                onClick={() => onSelect(method.id, 'paypal')}
              />
            );

          case 'venmo':
            return (
              <PaymentMethodOption
                key={method.id}
                icon={<VenmoIcon />}
                label="Venmo"
                subtitle={method.venmo.userName || method.venmo.email}
                onClick={() => onSelect(method.id, 'venmo')}
              />
            );

          case 'apple_pay':
            return (
              <PaymentMethodOption
                key={method.id}
                icon={<ApplePayIcon />}
                label={`Apple Pay - ${method.applePay.brand} •••• ${method.applePay.lastDigits}`}
                subtitle={`Expires ${method.applePay.expiry}`}
                onClick={() => onSelect(method.id, 'apple_pay')}
              />
            );
        }
      })}

      <PaymentMethodOption
        icon={<AddIcon />}
        label="Use a different payment method"
        onClick={() => onSelect(null, null)}
      />
    </div>
  );
}
```

---

# tRPC Endpoints Reference

| Endpoint | Description | Payment Methods |
|----------|-------------|-----------------|
| `customerVault.listSavedPaymentMethods` | List all saved payment methods | All |
| `customerVault.deleteSavedPaymentMethod` | Delete a saved payment method | All |
| `customerVault.createSetupToken` | Create setup token for vault-without-purchase | Card, PayPal, Venmo |
| `customerVault.createPaymentTokenFromSetupToken` | Complete vaulting from approved setup token | Card, PayPal, Venmo |

### createSetupToken Parameters

```typescript
{
  saleorUserId: string;           // Required
  paymentMethodType: "card" | "paypal" | "venmo";  // Default: "card"
  returnUrl?: string;             // Redirect after approval
  cancelUrl?: string;             // Redirect on cancel
  brandName?: string;             // Brand name shown to buyer
  verificationMethod?: "SCA_WHEN_REQUIRED" | "SCA_ALWAYS";  // For cards
  description?: string;           // For PayPal/Venmo
  usageType?: "MERCHANT" | "PLATFORM";  // For PayPal/Venmo
}
```

### createPaymentTokenFromSetupToken Response

```typescript
{
  paymentTokenId: string;         // Use as vaultId for future payments
  customerId: string;             // PayPal customer ID
  paymentMethodType: "card" | "paypal" | "venmo";
  card?: {                        // For card type
    brand: string;
    lastDigits: string;
    expiry?: string;
  };
  paypal?: {                      // For paypal type
    email: string;
    name?: string;
  };
  venmo?: {                       // For venmo type
    email?: string;
    userName?: string;
    name?: string;
  };
}
```

---

# Data Parameters Summary

## transactionInitialize Data Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `paymentMethodType` | `"card" \| "paypal" \| "venmo" \| "apple_pay"` | No (default: `"card"`) | Type of payment method |
| `savePaymentMethod` | `boolean` | No | Save payment method for future use |
| `vaultId` | `string` | No | ID of saved payment method to use |
| `saleorUserId` | `string` | Required for vaulting | Saleor user ID |
| `merchantInitiated` | `boolean` | No | MIT - buyer not present transaction |

## Flow Decision Matrix

| Scenario | paymentMethodType | savePaymentMethod | vaultId | merchantInitiated |
|----------|-------------------|-------------------|---------|-------------------|
| New card | `"card"` | `false` | - | - |
| Save card during purchase | `"card"` | `true` | - | - |
| Pay with saved card | `"card"` | - | `"xxx"` | `false` |
| MIT with saved card | `"card"` | - | `"xxx"` | `true` |
| Save PayPal during purchase | `"paypal"` | `true` | - | - |
| One-click PayPal | `"paypal"` | - | `"xxx"` | `false` |
| MIT with PayPal | `"paypal"` | - | `"xxx"` | `true` |
| Save Venmo during purchase | `"venmo"` | `true` | - | - |
| One-click Venmo | `"venmo"` | - | `"xxx"` | `false` |
| Save Apple Pay | `"apple_pay"` | `true` | - | - |
| Pay with saved Apple Pay | `"apple_pay"` | - | `"xxx"` | `false` |
| MIT with Apple Pay | `"apple_pay"` | - | `"xxx"` | `true` |

---

# Error Handling

| Error | Cause | Resolution |
|-------|-------|------------|
| Vaulting not available | `paymentMethodReadiness.vaulting === false` | Don't show save option |
| No saved methods | `savedPaymentMethods` empty | Show new payment form |
| User not logged in | No `saleorUserId` | Guest checkout, no vaulting |
| Setup token not approved | Buyer didn't complete approval | Re-initiate vault flow |
| Invalid payment method type | Unsupported type passed | Use valid type |
| MIT not supported | Venmo with `merchantInitiated: true` | Venmo is buyer-present only |

---

# IWT Compliance Checklist

Per IWT Page 15 (Vaulting Requirements):

- [x] User ID Token contains PayPal-Auth-Assertion header (backend)
- [x] Customer ID passed to "create order" for existing customers (backend)
- [x] **PayPal:** Vault with purchase option
- [x] **PayPal:** Vault without purchase (RBM)
- [x] **PayPal:** Return buyer one-click flow
- [x] **PayPal:** Vaulted payment shown on buttons (via `data-user-id-token`)
- [x] **PayPal:** `data-user-id-token` populated for vaulted buyers
- [x] **PayPal:** Buyer-not-present (MIT) transactions
- [x] **Venmo:** Vault with purchase option
- [x] **Venmo:** Return buyer one-click flow
- [x] **ACDC:** Vault with purchase option
- [x] **ACDC:** Return buyer saved card selection
- [x] **ACDC:** Multiple saved cards selection
- [x] **ACDC:** View saved cards and choose for transaction

---

# References

- [PayPal JS SDK Documentation](https://developer.paypal.com/sdk/js/)
- [PayPal Card Fields Integration](https://developer.paypal.com/docs/checkout/advanced/integrate/)
- [PayPal Vaulting API](https://developer.paypal.com/docs/api/payment-tokens/v3/)
- [PayPal Save Payment Methods](https://developer.paypal.com/docs/checkout/save-payment-methods/)
