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
import { TaxLookupRepository } from "@/modules/tax-lookups/tax-lookup-repository";
import { orderCalculateTaxesWebhookDefinition } from "@/modules/webhooks/definitions/order-calculate-taxes";

const orderCalculateTaxesResponse =
  buildSyncWebhookResponsePayload<"ORDER_CALCULATE_TAXES">;

type CalculateTaxesResponse = SyncWebhookResponsesMap["ORDER_CALCULATE_TAXES"];

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

interface TaxCalculationResponse {
  shipping_price_gross_amount?: number;
  shipping_price_net_amount?: number;
  shipping_tax_rate?: number;
  lines: Array<{
    total_gross_amount?: number;
    total_net_amount?: number;
    tax_rate?: number;
  }>;
}

const logger = createLogger("orderCalculateTaxes");

async function calculateTaxesHandler(
  request: NextRequest,
  authData: AuthData,
  payload: CalculateTaxesPayload
): Promise<NextResponse<CalculateTaxesResponse>> {
  try {
    // Initialize repositories
    const taxLookupRepository = await TaxLookupRepository.fromAuthData(authData);
    const appConfigRepository = await AppConfigRepository.fromAuthData(authData);

    // Initialize use case
    const calculateTaxesUseCase = new CalculateTaxesUseCase(
      appConfigRepository,
      taxLookupRepository,
      authData.saleorApiUrl,
      authData.appId
    );

    // Extract address from payload
    if (!payload.taxBase.address) {
      return NextResponse.json(
        { 
          lines: [],
          shipping_price_gross_amount: 0,
          shipping_price_net_amount: 0,
          shipping_tax_rate: 0
        },
        { status: 200 }
      );
    }

    const countryCode = payload.taxBase.address.country.code;

    const address: TaxCalculationAddress = {
      country: countryCode,
      countryArea: payload.taxBase.address.countryArea || null,
      postalCode: payload.taxBase.address.postalCode || null,
      city: payload.taxBase.address.city || null,
      streetAddress1: payload.taxBase.address.streetAddress1 || null,
      streetAddress2: payload.taxBase.address.streetAddress2 || null,
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

      return NextResponse.json(
        { 
          lines: [],
          shipping_price_gross_amount: 0,
          shipping_price_net_amount: 0,
          shipping_tax_rate: 0
        },
        { status: 200 }
      );
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
    return NextResponse.json(orderCalculateTaxesResponse(response));
  } catch (error) {
    logger.error("Unexpected error in tax calculation:", { error });

    return NextResponse.json(
      { 
        lines: [],
        shipping_price_gross_amount: 0,
        shipping_price_net_amount: 0,
        shipping_tax_rate: 0
      },
      { status: 500 }
    );
  }
}

// Create the webhook handler using the definition
export const POST = orderCalculateTaxesWebhookDefinition.createHandler(
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

      return NextResponse.json(
        { 
          lines: [],
          shipping_price_gross_amount: 0,
          shipping_price_net_amount: 0,
          shipping_tax_rate: 0
        },
        { status: 500 }
      );
    }
  }
);