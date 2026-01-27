# Frontend Mutation Examples for PayPal Vaulting

Complete code examples for integrating PayPal vaulting with Saleor GraphQL.

---

## Step 1: Initialize Payment Gateway (Get userIdToken)

**Call this first to get configuration and userIdToken for logged-in users.**

```typescript
// types.ts
interface PaymentGatewayConfig {
  paypalClientId: string;
  merchantClientId: string;
  merchantId: string;
  paymentMethodReadiness: {
    applePay: boolean;
    googlePay: boolean;
    paypalButtons: boolean;
    advancedCardProcessing: boolean;
    vaulting: boolean;
  };
  savedPaymentMethods: SavedPaymentMethod[];
  userIdToken?: string;
}

interface SavedPaymentMethod {
  id: string;
  type: "card" | "paypal" | "venmo" | "apple_pay";
  card?: { brand: string; lastDigits: string; expiry?: string };
  paypal?: { email: string; name?: string };
  venmo?: { email?: string; userName?: string; name?: string };
  applePay?: { brand?: string; lastDigits?: string; expiry?: string };
}

// graphql/mutations.ts
const PAYMENT_GATEWAY_INITIALIZE = `
  mutation PaymentGatewayInitialize(
    $checkoutId: ID!
    $amount: PositiveDecimal!
    $saleorUserId: String
  ) {
    paymentGatewayInitialize(
      id: $checkoutId
      amount: $amount
      paymentGateways: [
        {
          id: "saleor.app.payment.paypal"
          data: {
            saleorUserId: $saleorUserId
          }
        }
      ]
    ) {
      gatewayConfigs {
        id
        data
        errors {
          field
          message
        }
      }
      errors {
        field
        message
      }
    }
  }
`;

// hooks/usePaymentGateway.ts
async function initializePaymentGateway(
  checkoutId: string,
  amount: number,
  saleorUserId?: string
): Promise<PaymentGatewayConfig> {
  const response = await fetch(SALEOR_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${authToken}`
    },
    body: JSON.stringify({
      query: PAYMENT_GATEWAY_INITIALIZE,
      variables: {
        checkoutId,
        amount,
        saleorUserId  // Pass for logged-in users to get userIdToken
      }
    })
  });

  const { data } = await response.json();
  const paypalConfig = data.paymentGatewayInitialize.gatewayConfigs.find(
    (config: any) => config.id === "saleor.app.payment.paypal"
  );

  return paypalConfig.data as PaymentGatewayConfig;
}

// Example usage
const config = await initializePaymentGateway(
  "Q2hlY2tvdXQ6YWJjMTIz",
  100.00,
  "VXNlcjoxMjM0NTY="  // Logged-in user's Saleor ID
);

console.log(config.userIdToken);        // Use in data-user-id-token
console.log(config.savedPaymentMethods); // Show saved cards/wallets
console.log(config.paymentMethodReadiness.vaulting); // Can save new methods?
```

---

## Step 2: Load PayPal JS SDK with userIdToken

```typescript
// utils/loadPayPalScript.ts
function loadPayPalScript(config: PaymentGatewayConfig): Promise<void> {
  return new Promise((resolve, reject) => {
    // Remove existing script if any
    const existingScript = document.getElementById("paypal-js");
    if (existingScript) {
      existingScript.remove();
    }

    const script = document.createElement("script");
    script.id = "paypal-js";
    script.src = `https://www.paypal.com/sdk/js?client-id=${config.paypalClientId}&merchant-id=${config.merchantId}&components=buttons,card-fields&intent=capture&currency=USD`;

    // CRITICAL: Add userIdToken for vaulting
    if (config.userIdToken) {
      script.setAttribute("data-user-id-token", config.userIdToken);
    }

    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load PayPal SDK"));

    document.head.appendChild(script);
  });
}
```

---

## Step 3: Transaction Initialize Mutations

### 3A: New Card Payment (No Vaulting)

```typescript
const TRANSACTION_INITIALIZE = `
  mutation TransactionInitialize(
    $checkoutId: ID!
    $amount: PositiveDecimal!
    $data: JSON!
  ) {
    transactionInitialize(
      id: $checkoutId
      amount: $amount
      paymentGateway: {
        id: "saleor.app.payment.paypal"
        data: $data
      }
    ) {
      transaction {
        id
        pspReference
      }
      transactionEvent {
        type
        message
      }
      data
      errors {
        field
        message
      }
    }
  }
`;

// Simple card payment - no saving
async function payWithNewCard(checkoutId: string, amount: number) {
  return await graphqlRequest(TRANSACTION_INITIALIZE, {
    checkoutId,
    amount,
    data: {
      paymentMethodType: "card"
    }
  });
}
```

### 3B: Save Card During Purchase

```typescript
// Save card for future use
async function payAndSaveCard(
  checkoutId: string,
  amount: number,
  saleorUserId: string
) {
  return await graphqlRequest(TRANSACTION_INITIALIZE, {
    checkoutId,
    amount,
    data: {
      paymentMethodType: "card",
      savePaymentMethod: true,    // <-- Save the card
      saleorUserId: saleorUserId  // <-- Required for vaulting
    }
  });
}

// Example usage with checkbox
const saveCardCheckbox = document.getElementById("save-card") as HTMLInputElement;

async function handlePayment() {
  const response = await graphqlRequest(TRANSACTION_INITIALIZE, {
    checkoutId: currentCheckout.id,
    amount: currentCheckout.totalPrice,
    data: {
      paymentMethodType: "card",
      savePaymentMethod: saveCardCheckbox.checked,
      saleorUserId: currentUser?.id  // undefined for guest
    }
  });

  // Response contains PayPal order ID for JS SDK
  const paypalOrderId = response.data.transactionInitialize.data.paypal_order_id;
  return paypalOrderId;
}
```

### 3C: Pay with Saved Card (Return Buyer)

```typescript
// Use a previously saved card
async function payWithSavedCard(
  checkoutId: string,
  amount: number,
  savedCardId: string  // From savedPaymentMethods[].id
) {
  return await graphqlRequest(TRANSACTION_INITIALIZE, {
    checkoutId,
    amount,
    data: {
      paymentMethodType: "card",
      vaultId: savedCardId  // <-- Vault ID of saved card
    }
  });
}

// Example: User selects saved card from list
function onSavedCardSelected(savedMethod: SavedPaymentMethod) {
  payWithSavedCard(
    checkoutId,
    amount,
    savedMethod.id  // e.g., "8kk8451t"
  );
}
```

### 3D: Merchant-Initiated Transaction (MIT)

```typescript
// Charge saved card without buyer present (subscriptions, reorders)
async function chargeSavedCardMIT(
  checkoutId: string,
  amount: number,
  savedCardId: string
) {
  return await graphqlRequest(TRANSACTION_INITIALIZE, {
    checkoutId,
    amount,
    data: {
      paymentMethodType: "card",
      vaultId: savedCardId,
      merchantInitiated: true  // <-- Buyer not present
    }
  });
}
```

---

## Step 4: PayPal Wallet Vaulting

### 4A: Save PayPal Wallet During Purchase

```typescript
// PayPal button with vaulting
paypal.Buttons({
  createOrder: async () => {
    const response = await graphqlRequest(TRANSACTION_INITIALIZE, {
      checkoutId,
      amount,
      data: {
        paymentMethodType: "paypal",  // <-- PayPal wallet
        savePaymentMethod: true,       // <-- Save for future
        saleorUserId: currentUser.id
      }
    });
    return response.data.transactionInitialize.data.paypal_order_id;
  },

  onApprove: async (data) => {
    // Process the payment
    await transactionProcess(data.orderID);
  }
}).render("#paypal-button-container");
```

### 4B: One-Click PayPal (Return Buyer with Saved Wallet)

```typescript
// When userIdToken is set, PayPal button auto-shows saved wallet
// Just pass the vaultId to use specific saved wallet

paypal.Buttons({
  createOrder: async () => {
    const response = await graphqlRequest(TRANSACTION_INITIALIZE, {
      checkoutId,
      amount,
      data: {
        paymentMethodType: "paypal",
        vaultId: savedPayPalWalletId  // From savedPaymentMethods
      }
    });
    return response.data.transactionInitialize.data.paypal_order_id;
  },

  onApprove: async (data) => {
    await transactionProcess(data.orderID);
  }
}).render("#paypal-button-container");
```

---

## Step 5: Venmo Vaulting

```typescript
// Venmo button with vaulting
paypal.Buttons({
  fundingSource: paypal.FUNDING.VENMO,

  createOrder: async () => {
    const response = await graphqlRequest(TRANSACTION_INITIALIZE, {
      checkoutId,
      amount,
      data: {
        paymentMethodType: "venmo",
        savePaymentMethod: true,
        saleorUserId: currentUser.id
      }
    });
    return response.data.transactionInitialize.data.paypal_order_id;
  },

  onApprove: async (data) => {
    await transactionProcess(data.orderID);
  }
}).render("#venmo-button-container");

// NOTE: Venmo does NOT support merchantInitiated (MIT)
// Venmo is buyer-present only
```

---

## Step 6: Transaction Process (Capture/Authorize)

```typescript
const TRANSACTION_PROCESS = `
  mutation TransactionProcess(
    $transactionId: ID!
    $data: JSON
  ) {
    transactionProcess(
      id: $transactionId
      data: $data
    ) {
      transaction {
        id
        pspReference
        actions
      }
      transactionEvent {
        type
        message
      }
      data
      errors {
        field
        message
      }
    }
  }
`;

async function transactionProcess(paypalOrderId: string) {
  return await graphqlRequest(TRANSACTION_PROCESS, {
    transactionId: currentTransactionId,
    data: {
      paypalOrderId: paypalOrderId
    }
  });
}
```

---

## Complete Integration Example

```typescript
// components/PaymentForm.tsx
import { useEffect, useState } from "react";

interface Props {
  checkoutId: string;
  amount: number;
  user?: { id: string };
}

export function PaymentForm({ checkoutId, amount, user }: Props) {
  const [config, setConfig] = useState<PaymentGatewayConfig | null>(null);
  const [selectedMethod, setSelectedMethod] = useState<string | null>(null);
  const [saveCard, setSaveCard] = useState(false);

  // Step 1: Initialize gateway
  useEffect(() => {
    async function init() {
      const gatewayConfig = await initializePaymentGateway(
        checkoutId,
        amount,
        user?.id
      );
      setConfig(gatewayConfig);

      // Step 2: Load PayPal SDK with userIdToken
      await loadPayPalScript(gatewayConfig);
    }
    init();
  }, [checkoutId, amount, user?.id]);

  // Step 3: Handle payment
  const handlePayment = async () => {
    const data: Record<string, any> = {
      paymentMethodType: "card"
    };

    // Using saved card
    if (selectedMethod) {
      data.vaultId = selectedMethod;
    }
    // Saving new card
    else if (saveCard && user?.id) {
      data.savePaymentMethod = true;
      data.saleorUserId = user.id;
    }

    const response = await graphqlRequest(TRANSACTION_INITIALIZE, {
      checkoutId,
      amount,
      data
    });

    return response.data.transactionInitialize.data.paypal_order_id;
  };

  if (!config) return <div>Loading...</div>;

  return (
    <div>
      {/* Saved Payment Methods */}
      {config.savedPaymentMethods.length > 0 && (
        <div className="saved-methods">
          <h3>Saved Payment Methods</h3>
          {config.savedPaymentMethods.map((method) => (
            <label key={method.id}>
              <input
                type="radio"
                name="payment-method"
                value={method.id}
                onChange={() => setSelectedMethod(method.id)}
              />
              {method.type === "card" && (
                <span>{method.card?.brand} •••• {method.card?.lastDigits}</span>
              )}
              {method.type === "paypal" && (
                <span>PayPal - {method.paypal?.email}</span>
              )}
              {method.type === "venmo" && (
                <span>Venmo - {method.venmo?.userName}</span>
              )}
            </label>
          ))}
          <label>
            <input
              type="radio"
              name="payment-method"
              value=""
              onChange={() => setSelectedMethod(null)}
            />
            Use new payment method
          </label>
        </div>
      )}

      {/* New Card Form */}
      {!selectedMethod && (
        <div className="new-card-form">
          <div id="card-number-field"></div>
          <div id="card-expiry-field"></div>
          <div id="card-cvv-field"></div>

          {/* Save Card Checkbox - Only for logged-in users with vaulting enabled */}
          {user && config.paymentMethodReadiness.vaulting && (
            <label>
              <input
                type="checkbox"
                checked={saveCard}
                onChange={(e) => setSaveCard(e.target.checked)}
              />
              Save this card for future purchases
            </label>
          )}
        </div>
      )}

      {/* PayPal/Venmo Buttons */}
      <div id="paypal-button-container"></div>
      <div id="venmo-button-container"></div>

      <button onClick={handlePayment}>Pay ${amount}</button>
    </div>
  );
}
```

---

## Quick Reference: Data Parameters

| Scenario | paymentMethodType | savePaymentMethod | vaultId | saleorUserId | merchantInitiated | idempotencyKey |
|----------|-------------------|-------------------|---------|--------------|-------------------|----------------|
| New card (guest) | `"card"` | - | - | - | - | Optional |
| New card (save) | `"card"` | `true` | - | Required | - | Optional |
| Saved card | `"card"` | - | Required | - | - | Optional |
| MIT card | `"card"` | - | Required | - | `true` | Optional |
| PayPal (save) | `"paypal"` | `true` | - | Required | - | Optional |
| Saved PayPal | `"paypal"` | - | Required | - | - | Optional |
| MIT PayPal | `"paypal"` | - | Required | - | `true` | Optional |
| Venmo (save) | `"venmo"` | `true` | - | Required | - | Optional |
| Saved Venmo | `"venmo"` | - | Required | - | - | Optional |
| Apple Pay (save) | `"apple_pay"` | `true` | - | Required | - | Optional |
| Saved Apple Pay | `"apple_pay"` | - | Required | - | - | Optional |

---

## Idempotency (Preventing Duplicate Transactions)

Pass an `idempotencyKey` in `transactionInitialize` to prevent duplicate charges on network retry:

```typescript
// Generate a unique key per transaction attempt
const idempotencyKey = `${checkoutId}-${Date.now()}-${crypto.randomUUID()}`;

const response = await graphqlRequest(TRANSACTION_INITIALIZE, {
  checkoutId,
  amount,
  data: {
    paymentMethodType: "card",
    idempotencyKey: idempotencyKey  // <-- Prevents duplicate charges
  }
});
```

**How it works:**
- The backend sends this key as `PayPal-Request-Id` header to PayPal
- If the same key is sent twice, PayPal returns the original response instead of creating a duplicate transaction
- Use a unique key per transaction attempt (checkout ID + timestamp + UUID works well)
- If user retries payment with new card details, generate a NEW key

---

## Notes

1. **userIdToken** is returned only when:
   - `saleorUserId` is passed in `paymentGatewayInitialize`
   - Merchant has vaulting enabled (`vaulting: true`)

2. **Venmo** does NOT support `merchantInitiated: true`

3. **Guest users** cannot save payment methods (no `saleorUserId`)

4. **idempotencyKey** is optional but recommended for all payment scenarios
