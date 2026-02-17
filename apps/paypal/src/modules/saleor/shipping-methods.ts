/**
 * Saleor GraphQL operations for shipping address and delivery method updates.
 * Used by the PayPal shipping callback handler.
 */

import { Client } from "urql";

import { createLogger } from "@/lib/logger";
import { createGraphQLClient } from "@/lib/graphql-client";

const logger = createLogger("SaleorShippingMethods");

// GraphQL mutation to update checkout shipping address
const CHECKOUT_SHIPPING_ADDRESS_UPDATE = `
  mutation CheckoutShippingAddressUpdate($id: ID!, $shippingAddress: AddressInput!) {
    checkoutShippingAddressUpdate(id: $id, shippingAddress: $shippingAddress) {
      checkout {
        id
        isShippingRequired
        shippingMethods {
          id
          name
          price {
            amount
            currency
          }
          minimumDeliveryDays
          maximumDeliveryDays
        }
        subtotalPrice {
          net {
            amount
            currency
          }
          tax {
            amount
            currency
          }
          gross {
            amount
            currency
          }
        }
        shippingPrice {
          net {
            amount
            currency
          }
          gross {
            amount
            currency
          }
        }
        totalPrice {
          net {
            amount
            currency
          }
          tax {
            amount
            currency
          }
          gross {
            amount
            currency
          }
        }
        deliveryMethod {
          ... on ShippingMethod {
            id
            name
          }
        }
      }
      errors {
        field
        message
        code
      }
    }
  }
`;

// GraphQL mutation to update checkout delivery method
const CHECKOUT_DELIVERY_METHOD_UPDATE = `
  mutation CheckoutDeliveryMethodUpdate($id: ID!, $deliveryMethodId: ID!) {
    checkoutDeliveryMethodUpdate(id: $id, deliveryMethodId: $deliveryMethodId) {
      checkout {
        id
        subtotalPrice {
          net {
            amount
            currency
          }
          tax {
            amount
            currency
          }
        }
        shippingPrice {
          net {
            amount
            currency
          }
          gross {
            amount
            currency
          }
        }
        totalPrice {
          net {
            amount
            currency
          }
          tax {
            amount
            currency
          }
          gross {
            amount
            currency
          }
        }
        shippingMethods {
          id
          name
          price {
            amount
            currency
          }
          minimumDeliveryDays
          maximumDeliveryDays
        }
      }
      errors {
        field
        message
        code
      }
    }
  }
`;

export interface ShippingAddressInput {
  streetAddress1?: string;
  streetAddress2?: string;
  city?: string;
  countryArea?: string;
  postalCode?: string;
  country?: string;
  firstName?: string;
  lastName?: string;
  companyName?: string;
  phone?: string;
}

export interface ShippingMethod {
  id: string;
  name: string;
  price: {
    amount: number;
    currency: string;
  };
  minimumDeliveryDays?: number | null;
  maximumDeliveryDays?: number | null;
}

export interface CheckoutPrices {
  subtotalNet: number;
  subtotalTax: number;
  shippingNet: number;
  shippingGross: number;
  totalNet: number;
  totalTax: number;
  totalGross: number;
  currency: string;
}

export interface UpdateShippingAddressResult {
  success: boolean;
  isShippingRequired: boolean;
  shippingMethods: ShippingMethod[];
  prices: CheckoutPrices | null;
  currentDeliveryMethodId: string | null;
  errors: Array<{ field: string | null; message: string; code: string }>;
}

export interface UpdateDeliveryMethodResult {
  success: boolean;
  shippingMethods: ShippingMethod[];
  prices: CheckoutPrices | null;
  errors: Array<{ field: string | null; message: string; code: string }>;
}

function extractPrices(checkout: any): CheckoutPrices {
  return {
    subtotalNet: checkout.subtotalPrice?.net?.amount ?? 0,
    subtotalTax: checkout.subtotalPrice?.tax?.amount ?? 0,
    shippingNet: checkout.shippingPrice?.net?.amount ?? 0,
    shippingGross: checkout.shippingPrice?.gross?.amount ?? 0,
    totalNet: checkout.totalPrice?.net?.amount ?? 0,
    totalTax: checkout.totalPrice?.tax?.amount ?? 0,
    totalGross: checkout.totalPrice?.gross?.amount ?? 0,
    currency: checkout.totalPrice?.net?.currency || checkout.subtotalPrice?.net?.currency || "USD",
  };
}

function extractShippingMethods(methods: any[]): ShippingMethod[] {
  return (methods || []).map((m: any) => ({
    id: m.id,
    name: m.name,
    price: {
      amount: m.price?.amount ?? 0,
      currency: m.price?.currency || "USD",
    },
    minimumDeliveryDays: m.minimumDeliveryDays ?? null,
    maximumDeliveryDays: m.maximumDeliveryDays ?? null,
  }));
}

/**
 * Update the shipping address on a Saleor checkout and return available shipping methods.
 */
export async function updateCheckoutShippingAddress(
  saleorApiUrl: string,
  token: string,
  checkoutId: string,
  address: ShippingAddressInput,
): Promise<UpdateShippingAddressResult> {
  const client = createGraphQLClient(saleorApiUrl, token);

  logger.info("Updating checkout shipping address", {
    checkoutId,
    country: address.country,
    city: address.city,
  });

  const result = await client.mutation(CHECKOUT_SHIPPING_ADDRESS_UPDATE, {
    id: checkoutId,
    shippingAddress: address,
  }).toPromise();

  if (result.error) {
    logger.error("GraphQL error updating shipping address", {
      checkoutId,
      error: result.error.message,
    });

    return {
      success: false,
      isShippingRequired: true,
      shippingMethods: [],
      prices: null,
      currentDeliveryMethodId: null,
      errors: [{ field: null, message: result.error.message, code: "GRAPHQL_ERROR" }],
    };
  }

  const data = result.data?.checkoutShippingAddressUpdate;

  if (!data) {
    return {
      success: false,
      isShippingRequired: true,
      shippingMethods: [],
      prices: null,
      currentDeliveryMethodId: null,
      errors: [{ field: null, message: "No response from Saleor", code: "NO_RESPONSE" }],
    };
  }

  if (data.errors && data.errors.length > 0) {
    logger.warn("Saleor returned errors for shipping address update", {
      checkoutId,
      errors: data.errors,
    });

    return {
      success: false,
      isShippingRequired: true,
      shippingMethods: [],
      prices: null,
      currentDeliveryMethodId: null,
      errors: data.errors,
    };
  }

  const checkout = data.checkout;

  return {
    success: true,
    isShippingRequired: checkout.isShippingRequired ?? true,
    shippingMethods: extractShippingMethods(checkout.shippingMethods),
    prices: extractPrices(checkout),
    currentDeliveryMethodId: checkout.deliveryMethod?.id ?? null,
    errors: [],
  };
}

/**
 * Update the delivery method on a Saleor checkout and return recalculated prices.
 */
export async function updateCheckoutDeliveryMethod(
  saleorApiUrl: string,
  token: string,
  checkoutId: string,
  deliveryMethodId: string,
): Promise<UpdateDeliveryMethodResult> {
  const client = createGraphQLClient(saleorApiUrl, token);

  logger.info("Updating checkout delivery method", {
    checkoutId,
    deliveryMethodId,
  });

  const result = await client.mutation(CHECKOUT_DELIVERY_METHOD_UPDATE, {
    id: checkoutId,
    deliveryMethodId,
  }).toPromise();

  if (result.error) {
    logger.error("GraphQL error updating delivery method", {
      checkoutId,
      error: result.error.message,
    });

    return {
      success: false,
      shippingMethods: [],
      prices: null,
      errors: [{ field: null, message: result.error.message, code: "GRAPHQL_ERROR" }],
    };
  }

  const data = result.data?.checkoutDeliveryMethodUpdate;

  if (!data) {
    return {
      success: false,
      shippingMethods: [],
      prices: null,
      errors: [{ field: null, message: "No response from Saleor", code: "NO_RESPONSE" }],
    };
  }

  if (data.errors && data.errors.length > 0) {
    logger.warn("Saleor returned errors for delivery method update", {
      checkoutId,
      errors: data.errors,
    });

    return {
      success: false,
      shippingMethods: [],
      prices: null,
      errors: data.errors,
    };
  }

  const checkout = data.checkout;

  return {
    success: true,
    shippingMethods: extractShippingMethods(checkout.shippingMethods),
    prices: extractPrices(checkout),
    errors: [],
  };
}
