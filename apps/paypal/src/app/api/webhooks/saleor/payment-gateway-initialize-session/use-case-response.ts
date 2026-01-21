import { z } from "zod";

import { SuccessWebhookResponse } from "@/app/api/webhooks/saleor/saleor-webhook-responses";
import { PaymentGatewayInitializeSession } from "@/generated/app-webhooks-types/payment-gateway-initialize-session";
import { AppContext } from "@/lib/app-context";
import { PayPalClientId } from "@/modules/paypal/paypal-client-id";

/**
 * Saved payment method for ACDC Card Vaulting (Phase 1)
 * Returned in PaymentGatewayInitializeSession for "Return Buyer" flow
 */
export interface SavedPaymentMethod {
  id: string; // PayPal payment token ID (vault_id)
  type: "card";
  card: {
    brand: string;
    lastDigits: string;
    expiry?: string;
  };
}

class Success extends SuccessWebhookResponse {
  readonly pk: PayPalClientId;
  readonly merchantClientId?: string;
  readonly merchantId?: string;
  readonly paymentMethodReadiness?: {
    applePay: boolean;
    googlePay: boolean;
    paypalButtons: boolean;
    advancedCardProcessing: boolean;
    vaulting: boolean;
  };
  readonly savedPaymentMethods: SavedPaymentMethod[];

  private static ResponseDataSchema = z.object({
    paypalClientId: z.string(),
    merchantClientId: z.string().optional(),
    merchantId: z.string().optional(),
    paymentMethodReadiness: z.object({
      applePay: z.boolean(),
      googlePay: z.boolean(),
      paypalButtons: z.boolean(),
      advancedCardProcessing: z.boolean(),
      vaulting: z.boolean(),
    }).optional(),
    // ACDC Card Vaulting - saved payment methods for Return Buyer flow
    savedPaymentMethods: z.array(z.object({
      id: z.string(),
      type: z.literal("card"),
      card: z.object({
        brand: z.string(),
        lastDigits: z.string(),
        expiry: z.string().optional(),
      }),
    })).optional(),
  });

  constructor(args: {
    pk: PayPalClientId;
    merchantClientId?: string;
    merchantId?: string;
    paymentMethodReadiness?: {
      applePay: boolean;
      googlePay: boolean;
      paypalButtons: boolean;
      advancedCardProcessing: boolean;
      vaulting: boolean;
    };
    savedPaymentMethods?: SavedPaymentMethod[];
    appContext: AppContext;
  }) {
    super(args.appContext);
    this.pk = args.pk;
    this.merchantClientId = args.merchantClientId;
    this.merchantId = args.merchantId;
    this.paymentMethodReadiness = args.paymentMethodReadiness;
    this.savedPaymentMethods = args.savedPaymentMethods || [];
  }

  getResponse() {
    const typeSafeResponse: PaymentGatewayInitializeSession = {
      data: Success.ResponseDataSchema.parse({
        paypalClientId: this.pk,
        merchantClientId: this.merchantClientId,
        merchantId: this.merchantId,
        paymentMethodReadiness: this.paymentMethodReadiness,
        savedPaymentMethods: this.savedPaymentMethods.length > 0 ? this.savedPaymentMethods : undefined,
      }),
    };

    return Response.json(typeSafeResponse, { status: this.statusCode });
  }
}

export const PaymentGatewayInitializeSessionUseCaseResponses = {
  Success,
};

export type PaymentGatewayInitializeSessionUseCaseResponsesType = InstanceType<
  typeof PaymentGatewayInitializeSessionUseCaseResponses.Success
>;
