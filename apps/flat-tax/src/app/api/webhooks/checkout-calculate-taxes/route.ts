import { AuthData } from "@saleor/app-sdk/APL";
import { buildSyncWebhookResponsePayload, SyncWebhookResponsesMap } from "@saleor/app-sdk/handlers/shared";
import { NextRequest, NextResponse } from "next/server";

import { createLogger } from "@/logger";
import { AppConfigRepository } from "@/modules/app-config/app-config-repository";
import {
  CalculateTaxesUseCase,
  TaxCalculationRequest,
  TaxCalculationAddress
} from "@/modules/calculate-taxes/calculate-taxes.use-case";
import { TaxRateRepository } from "@/modules/tax-rates/tax-rate-repository";
import { SupportedCountry } from "@/modules/tax-rates/tax-rate-schema";
import { checkoutCalculateTaxesWebhookDefinition } from "@/modules/webhooks/definitions/checkout-calculate-taxes";

const checkoutCalculateTaxesResponse =
  buildSyncWebhookResponsePayload<"CHECKOUT_CALCULATE_TAXES">;

type CalculateTaxesResponse = SyncWebhookResponsesMap["CHECKOUT_CALCULATE_TAXES"];

interface CalculateTaxesPayload {
  taxBase: {
    pricesEnteredWithTax: boolean;
    currency: string;
    channel: {
      id: string;
      slug: string;
    };
    address: {
      country: {
        code: string;
      };
      countryArea?: string;
      postalCode?: string;
      city?: string;
      streetAddress1?: string;
      streetAddress2?: string;
    } | null;
    lines: Array<{
      quantity: number;
      unitPrice: {
        amount: number;
      };
      totalPrice: {
        amount: number;
      };
    }>;
    shippingPrice: {
      amount: number;
    };
    discounts: Array<{
      amount: {
        amount: number;
      };
      type: string;
    }>;
  };
}

const logger = createLogger("checkoutCalculateTaxes");

async function calculateTaxesHandler(
  request: NextRequest,
  authData: AuthData,
  payload: CalculateTaxesPayload
): Promise<NextResponse<CalculateTaxesResponse>> {
  try {
    // Initialize repositories
    const taxRateRepository = await TaxRateRepository.fromAuthData(authData);
    const appConfigRepository = await AppConfigRepository.fromAuthData(authData);
    
    // Initialize use case
    const calculateTaxesUseCase = new CalculateTaxesUseCase(
      taxRateRepository,
      authData.saleorApiUrl,
      authData.token
    );

    // Extract address from payload
    if (!payload.taxBase.address) {
      return NextResponse.json(checkoutCalculateTaxesResponse({
        shipping_price_gross_amount: 0,
        shipping_price_net_amount: 0,
        shipping_tax_rate: 0,
        lines: [],
      }));
    }

    const countryCode = payload.taxBase.address.country.code;

    if (!["CA", "MX", "US"].includes(countryCode)) {
      return NextResponse.json(checkoutCalculateTaxesResponse({
        shipping_price_gross_amount: 0,
        shipping_price_net_amount: 0,
        shipping_tax_rate: 0,
        lines: [],
      }));
    }

    const address: TaxCalculationAddress = {
      country: countryCode as SupportedCountry,
      countryArea: payload.taxBase.address.countryArea || null,
      postalCode: payload.taxBase.address.postalCode || null,
    };

    // Calculate total amount for tax calculation
    const linesTotal = payload.taxBase.lines.reduce(
      (sum, line) => sum + line.totalPrice.amount,
      0
    );
    const shippingAmount = payload.taxBase.shippingPrice.amount;
    const discountsTotal = payload.taxBase.discounts.reduce(
      (sum, discount) => sum + discount.amount.amount,
      0
    );
    
    const totalAmount = linesTotal + shippingAmount - discountsTotal;

    // Calculate tax
    const taxRequest: TaxCalculationRequest = {
      billingAddress: address,
      shippingAddress: address,
      lines: payload.taxBase.lines.map(line => ({
        unitPrice: line.unitPrice.amount,
        totalPrice: line.totalPrice.amount,
        quantity: line.quantity,
        productId: undefined, // Product ID not available in this payload structure
      })),
      currency: payload.taxBase.currency,
      pricesEnteredWithTax: payload.taxBase.pricesEnteredWithTax,
    };
    
    const taxResult = await calculateTaxesUseCase.execute(taxRequest);

    if (taxResult.isErr()) {
      logger.error("Tax calculation failed:", { error: taxResult.error, address });

      return NextResponse.json(checkoutCalculateTaxesResponse({
        shipping_price_gross_amount: 0,
        shipping_price_net_amount: 0,
        shipping_tax_rate: 0,
        lines: [],
      }));
    }

    const tax = taxResult.value;
    // Use first line's tax rate for overall rate (simplified approach)
    const taxRate = tax.lines.length > 0 ? tax.lines[0].taxRate : 0;

    // Build response using calculated tax results - matching AvaTax response format
    const response: CalculateTaxesResponse = {
      shipping_price_gross_amount: 0,
      shipping_price_net_amount: 0,
      shipping_tax_rate: 0,
      lines: tax.lines.map(line => ({
        total_gross_amount: line.totalGrossMoney.amount,
        total_net_amount: line.totalNetMoney.amount,
        tax_rate: line.taxRate,
      })),
    };

    // Add shipping tax if there's shipping cost
    if (shippingAmount > 0) {
      const shippingTaxAmount = (shippingAmount * taxRate) / 100;
      const shippingNet = shippingAmount - shippingTaxAmount;

      response.shipping_price_gross_amount = shippingAmount;
      response.shipping_price_net_amount = shippingNet;
      response.shipping_tax_rate = taxRate;
    }

    // Use the Saleor SDK response builder for proper formatting
    return NextResponse.json(checkoutCalculateTaxesResponse(response));
  } catch (error) {
    logger.error("Unexpected error in tax calculation:", { error });

    return NextResponse.json(checkoutCalculateTaxesResponse({
      shipping_price_gross_amount: 0,
      shipping_price_net_amount: 0,
      shipping_tax_rate: 0,
      lines: [],
    }), { status: 500 });
  }
}

// Create the webhook handler using the definition
export const POST = checkoutCalculateTaxesWebhookDefinition.createHandler(
  async (req, context) => {
    try {
      logger.info("Webhook received", {
        saleorApiUrl: context.authData.saleorApiUrl,
        appId: context.authData.appId,
      });

      return await calculateTaxesHandler(
        req,
        context.authData,
        context.payload as CalculateTaxesPayload
      );
    } catch (error) {
      logger.error("Webhook handler error:", { error });

      return NextResponse.json(checkoutCalculateTaxesResponse({
        shipping_price_gross_amount: 0,
        shipping_price_net_amount: 0,
        shipping_tax_rate: 0,
        lines: [],
      }), { status: 500 });
    }
  }
);