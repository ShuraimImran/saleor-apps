import { NextRequest, NextResponse } from "next/server";

import { getPool } from "@/lib/database";
import { createLogger } from "@/lib/logger";
import { PostgresOrderCheckoutMappingRepository } from "@/modules/checkout-mapping/order-checkout-mapping-repository";
import {
  mapPayPalAddressToSaleor,
  mapSaleorShippingToPayPal,
  buildPayPalAmountBreakdown,
  type PayPalAddress,
} from "@/modules/paypal/address-mapper";
import { apl } from "@/lib/saleor-app";
import {
  updateCheckoutShippingAddress,
  updateCheckoutDeliveryMethod,
} from "@/modules/saleor/shipping-methods";

const logger = createLogger("PayPalOrderUpdateCallback");

/**
 * PayPal Order Update Callback Handler
 *
 * This endpoint handles callbacks from PayPal when buyers update their information during checkout.
 * Supported events:
 * - SHIPPING_CHANGE: Buyer changed their shipping address
 * - SHIPPING_OPTIONS_CHANGE: Request for shipping options based on address
 * - BILLING_ADDRESS_CHANGE: Buyer changed their billing address
 * - PHONE_NUMBER_CHANGE: Buyer changed their phone number
 *
 * Response format:
 * - 200 OK: Changes accepted, optionally return updated shipping options
 * - 422 Unprocessable Entity: Changes rejected (e.g., don't ship to that address)
 *
 * @see https://developer.paypal.com/docs/checkout/advanced/customize/shipping-callback/
 */
export async function POST(request: NextRequest) {
  logger.info("=== PAYPAL CALLBACK RECEIVED ===", {
    timestamp: new Date().toISOString(),
    headers: Object.fromEntries(request.headers.entries()),
  });

  try {
    const body = await request.json();

    logger.info("Received PayPal order update callback", {
      eventType: body.event_type,
      orderId: body.resource?.id,
      fullBody: JSON.stringify(body, null, 2),
    });

    const resource = body.resource;

    if (!resource) {
      logger.warn("Invalid callback payload - missing resource");
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }

    // Extract the PayPal order ID
    const paypalOrderId = resource.id;

    if (!paypalOrderId) {
      logger.warn("No PayPal order ID in callback payload");
      return NextResponse.json({ error: "Missing order ID" }, { status: 400 });
    }

    // Look up the Saleor checkout for this PayPal order
    const pool = getPool();
    const mappingRepo = PostgresOrderCheckoutMappingRepository.create(pool);
    const mapping = await mappingRepo.findByPayPalOrderId(paypalOrderId);

    if (!mapping) {
      logger.warn("No checkout mapping found for PayPal order", { paypalOrderId });
      return NextResponse.json(
        { error: "Order mapping not found or expired" },
        { status: 400 },
      );
    }

    // Get the Saleor auth data for this API URL
    const authData = await apl.get(mapping.saleorApiUrl);

    if (!authData) {
      logger.error("No auth data found for Saleor API URL", {
        saleorApiUrl: mapping.saleorApiUrl,
      });
      return NextResponse.json(
        { error: "Configuration error" },
        { status: 500 },
      );
    }

    // Extract shipping address from the PayPal payload
    const shippingAddress: PayPalAddress | undefined =
      resource.purchase_units?.[0]?.shipping?.address;

    // Handle based on what changed
    const selectedShippingOption = resource.purchase_units?.[0]?.shipping?.options?.find(
      (opt: any) => opt.selected,
    );

    // If a shipping option was selected (buyer picked a different one)
    if (selectedShippingOption?.id) {
      return await handleShippingOptionSelected({
        authData,
        mapping,
        selectedOptionId: selectedShippingOption.id,
        resource,
      });
    }

    // If shipping address changed
    if (shippingAddress) {
      return await handleShippingAddressChange({
        authData,
        mapping,
        shippingAddress,
        resource,
      });
    }

    // For billing address or phone changes, just accept
    logger.info("Accepting non-shipping callback without modifications", {
      paypalOrderId,
    });

    return NextResponse.json({}, { status: 200 });
  } catch (error) {
    logger.error("Error processing PayPal callback", { error });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

/**
 * Handle shipping address change: update Saleor checkout, return available methods
 */
async function handleShippingAddressChange(args: {
  authData: { token: string; saleorApiUrl: string };
  mapping: { saleorCheckoutId: string; saleorApiUrl: string };
  shippingAddress: PayPalAddress;
  resource: any;
}) {
  const { authData, mapping, shippingAddress, resource } = args;

  logger.info("Processing shipping address change", {
    country: shippingAddress.country_code,
    city: shippingAddress.admin_area_2,
  });

  // Convert PayPal address to Saleor format
  const saleorAddress = mapPayPalAddressToSaleor(shippingAddress);

  // Update the checkout's shipping address in Saleor
  const result = await updateCheckoutShippingAddress(
    mapping.saleorApiUrl,
    authData.token,
    mapping.saleorCheckoutId,
    saleorAddress,
  );

  if (!result.success) {
    logger.warn("Saleor rejected shipping address", {
      errors: result.errors,
      country: shippingAddress.country_code,
    });

    // 422 tells PayPal the address is not serviceable
    return NextResponse.json(
      { error: "Cannot ship to this address", details: result.errors },
      { status: 422 },
    );
  }

  // If no shipping is required (digital goods), just accept
  if (!result.isShippingRequired) {
    logger.info("Checkout does not require shipping, accepting address change");
    return NextResponse.json({}, { status: 200 });
  }

  // No shipping methods available for this address
  if (result.shippingMethods.length === 0) {
    logger.warn("No shipping methods available for address", {
      country: shippingAddress.country_code,
    });

    return NextResponse.json(
      { error: "No shipping methods available for this address" },
      { status: 422 },
    );
  }

  const prices = result.prices!;
  const currency = prices.currency;

  // Convert Saleor shipping methods to PayPal format
  const paypalShippingOptions = mapSaleorShippingToPayPal(
    result.shippingMethods,
    currency,
  );

  // The cheapest option is auto-selected. Use its price for the breakdown.
  const selectedOption = paypalShippingOptions.find((o) => o.selected);
  const shippingCost = selectedOption ? parseFloat(selectedOption.amount.value) : 0;

  // If Saleor already auto-selected a delivery method and recalculated, use those prices.
  // Otherwise use subtotal + selected shipping option price.
  const itemTotal = prices.subtotalNet;
  const taxTotal = prices.subtotalTax;

  // Build the response with updated amounts and shipping options
  const responseBody = {
    purchase_units: [
      {
        amount: buildPayPalAmountBreakdown({
          itemTotal,
          shipping: shippingCost,
          taxTotal,
          currency,
        }),
        shipping: {
          options: paypalShippingOptions,
        },
      },
    ],
  };

  logger.info("Returning shipping options to PayPal", {
    optionsCount: paypalShippingOptions.length,
    selectedId: selectedOption?.id,
    total: (itemTotal + shippingCost + taxTotal).toFixed(2),
    currency,
  });

  return NextResponse.json(responseBody, { status: 200 });
}

/**
 * Handle shipping option selection: update Saleor delivery method, return recalculated totals
 */
async function handleShippingOptionSelected(args: {
  authData: { token: string; saleorApiUrl: string };
  mapping: { saleorCheckoutId: string; saleorApiUrl: string };
  selectedOptionId: string;
  resource: any;
}) {
  const { authData, mapping, selectedOptionId, resource } = args;

  logger.info("Processing shipping option selection", {
    selectedOptionId,
  });

  // Update the delivery method in Saleor
  const result = await updateCheckoutDeliveryMethod(
    mapping.saleorApiUrl,
    authData.token,
    mapping.saleorCheckoutId,
    selectedOptionId, // Saleor shipping method ID is used as PayPal option ID
  );

  if (!result.success) {
    logger.warn("Saleor rejected delivery method update", {
      errors: result.errors,
      selectedOptionId,
    });

    return NextResponse.json(
      { error: "Failed to update shipping method" },
      { status: 422 },
    );
  }

  const prices = result.prices!;
  const currency = prices.currency;

  // Rebuild the shipping options list with the new selection
  const paypalShippingOptions = mapSaleorShippingToPayPal(
    result.shippingMethods,
    currency,
  ).map((option) => ({
    ...option,
    selected: option.id === selectedOptionId,
  }));

  const selectedOption = paypalShippingOptions.find((o) => o.selected);
  const shippingCost = selectedOption ? parseFloat(selectedOption.amount.value) : prices.shippingNet;

  const responseBody = {
    purchase_units: [
      {
        amount: buildPayPalAmountBreakdown({
          itemTotal: prices.subtotalNet,
          shipping: shippingCost,
          taxTotal: prices.totalTax - prices.subtotalTax, // shipping tax portion
          currency,
        }),
        shipping: {
          options: paypalShippingOptions,
        },
      },
    ],
  };

  logger.info("Returning updated totals to PayPal after shipping option change", {
    selectedOptionId,
    total: prices.totalGross.toFixed(2),
    currency,
  });

  return NextResponse.json(responseBody, { status: 200 });
}
