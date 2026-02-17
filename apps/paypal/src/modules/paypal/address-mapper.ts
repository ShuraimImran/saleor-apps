/**
 * Maps PayPal address format to Saleor AddressInput format and vice versa.
 * Maps Saleor shipping methods to PayPal shipping options format.
 */

import { createLogger } from "@/lib/logger";

const logger = createLogger("AddressMapper");

/**
 * PayPal address format from shipping callback
 */
export interface PayPalAddress {
  address_line_1?: string;
  address_line_2?: string;
  admin_area_1?: string; // State/Province
  admin_area_2?: string; // City
  postal_code?: string;
  country_code?: string; // ISO 3166-1 alpha-2
}

/**
 * Saleor AddressInput format
 */
export interface SaleorAddressInput {
  firstName?: string;
  lastName?: string;
  streetAddress1?: string;
  streetAddress2?: string;
  city?: string;
  countryArea?: string;
  postalCode?: string;
  country?: string; // ISO 3166-1 alpha-2
  companyName?: string;
  phone?: string;
}

/**
 * Saleor shipping method from checkout query
 */
export interface SaleorShippingMethod {
  id: string;
  name: string;
  price: {
    amount: number;
    currency: string;
  };
  minimumDeliveryDays?: number | null;
  maximumDeliveryDays?: number | null;
}

/**
 * PayPal shipping option format for callback response
 */
export interface PayPalShippingOption {
  id: string;
  label: string;
  amount: {
    currency_code: string;
    value: string;
  };
  selected: boolean;
  type: "SHIPPING" | "PICKUP";
}

/**
 * Convert PayPal address to Saleor AddressInput
 */
export function mapPayPalAddressToSaleor(paypalAddress: PayPalAddress): SaleorAddressInput {
  const mapped: SaleorAddressInput = {
    streetAddress1: paypalAddress.address_line_1 || "",
    streetAddress2: paypalAddress.address_line_2 || "",
    city: paypalAddress.admin_area_2 || "",
    countryArea: paypalAddress.admin_area_1 || "",
    postalCode: paypalAddress.postal_code || "",
    country: paypalAddress.country_code || "",
  };

  logger.debug("Mapped PayPal address to Saleor format", {
    paypalCountry: paypalAddress.country_code,
    saleorCountry: mapped.country,
    city: mapped.city,
  });

  return mapped;
}

/**
 * Convert Saleor shipping methods to PayPal shipping options.
 * Sorts by price ascending, cheapest option selected by default.
 */
export function mapSaleorShippingToPayPal(
  methods: SaleorShippingMethod[],
  currency: string,
): PayPalShippingOption[] {
  // Sort by price ascending
  const sorted = [...methods].sort((a, b) => a.price.amount - b.price.amount);

  return sorted.map((method, index) => {
    // Build label with delivery estimate if available
    let label = method.name;

    if (method.minimumDeliveryDays != null && method.maximumDeliveryDays != null) {
      label += ` (${method.minimumDeliveryDays}-${method.maximumDeliveryDays} days)`;
    } else if (method.maximumDeliveryDays != null) {
      label += ` (up to ${method.maximumDeliveryDays} days)`;
    }

    return {
      id: method.id,
      label,
      amount: {
        currency_code: currency,
        value: method.price.amount.toFixed(2),
      },
      selected: index === 0, // Cheapest is default
      type: "SHIPPING" as const,
    };
  });
}

/**
 * Build PayPal purchase_units amount breakdown for callback response.
 */
export function buildPayPalAmountBreakdown(args: {
  itemTotal: number;
  shipping: number;
  taxTotal: number;
  currency: string;
}) {
  const { itemTotal, shipping, taxTotal, currency } = args;
  const total = itemTotal + shipping + taxTotal;

  return {
    currency_code: currency,
    value: total.toFixed(2),
    breakdown: {
      item_total: {
        currency_code: currency,
        value: itemTotal.toFixed(2),
      },
      shipping: {
        currency_code: currency,
        value: shipping.toFixed(2),
      },
      tax_total: {
        currency_code: currency,
        value: taxTotal.toFixed(2),
      },
    },
  };
}
