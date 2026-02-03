import { z } from "zod";

import { SuccessWebhookResponse } from "@/app/api/webhooks/saleor/saleor-webhook-responses";
import { PaymentGatewayInitializeSession } from "@/generated/app-webhooks-types/payment-gateway-initialize-session";
import { AppContext } from "@/lib/app-context";
import { PayPalClientId } from "@/modules/paypal/paypal-client-id";

/**
 * Saved card payment method for ACDC Card Vaulting (Phase 1)
 */
export interface SavedCardPaymentMethod {
  id: string; // PayPal payment token ID (vault_id)
  type: "card";
  card: {
    brand: string;
    lastDigits: string;
    expiry?: string;
  };
}

/**
 * Saved PayPal wallet payment method for PayPal Wallet Vaulting (Phase 2)
 */
export interface SavedPayPalPaymentMethod {
  id: string; // PayPal payment token ID (vault_id)
  type: "paypal";
  paypal: {
    email: string;
    name?: string;
  };
}

/**
 * Saved Venmo payment method for Venmo Vaulting (Phase 2)
 */
export interface SavedVenmoPaymentMethod {
  id: string; // PayPal payment token ID (vault_id)
  type: "venmo";
  venmo: {
    email?: string;
    userName?: string;
    name?: string;
  };
}

/**
 * Saved Apple Pay payment method for Apple Pay Vaulting (Phase 2)
 * Used for recurring/unscheduled payments
 */
export interface SavedApplePayPaymentMethod {
  id: string; // PayPal payment token ID (vault_id)
  type: "apple_pay";
  applePay: {
    brand?: string;
    lastDigits?: string;
    expiry?: string;
    cardType?: string;
    email?: string;
    name?: string;
  };
}

/**
 * Saved payment method for vaulting
 * Supports Card (Phase 1), PayPal Wallet, Venmo, and Apple Pay (Phase 2)
 * Returned in PaymentGatewayInitializeSession for "Return Buyer" flow
 */
export type SavedPaymentMethod = SavedCardPaymentMethod | SavedPayPalPaymentMethod | SavedVenmoPaymentMethod | SavedApplePayPaymentMethod;

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
  readonly userIdToken?: string;

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
    /*
     * Saved payment methods for Return Buyer flow
     * Supports Card (Phase 1), PayPal Wallet (Phase 2), and Venmo (Phase 2)
     */
    savedPaymentMethods: z.array(z.discriminatedUnion("type", [
      // Card payment method (ACDC - Phase 1)
      z.object({
        id: z.string(),
        type: z.literal("card"),
        card: z.object({
          brand: z.string(),
          lastDigits: z.string(),
          expiry: z.string().optional(),
        }),
      }),
      // PayPal wallet payment method (Phase 2)
      z.object({
        id: z.string(),
        type: z.literal("paypal"),
        paypal: z.object({
          email: z.string(),
          name: z.string().optional(),
        }),
      }),
      // Venmo payment method (Phase 2)
      z.object({
        id: z.string(),
        type: z.literal("venmo"),
        venmo: z.object({
          email: z.string().optional(),
          userName: z.string().optional(),
          name: z.string().optional(),
        }),
      }),
      // Apple Pay payment method (Phase 2)
      z.object({
        id: z.string(),
        type: z.literal("apple_pay"),
        applePay: z.object({
          brand: z.string().optional(),
          lastDigits: z.string().optional(),
          expiry: z.string().optional(),
          cardType: z.string().optional(),
          email: z.string().optional(),
          name: z.string().optional(),
        }),
      }),
    ])).optional(),
    /*
     * User ID Token for JS SDK vaulting (data-user-id-token attribute)
     * Required for displaying vaulted PayPal/Venmo buttons and saving new payment methods
     */
    userIdToken: z.string().optional(),
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
    userIdToken?: string;
    appContext: AppContext;
  }) {
    super(args.appContext);
    this.pk = args.pk;
    this.merchantClientId = args.merchantClientId;
    this.merchantId = args.merchantId;
    this.paymentMethodReadiness = args.paymentMethodReadiness;
    this.savedPaymentMethods = args.savedPaymentMethods || [];
    this.userIdToken = args.userIdToken;
  }

  getResponse() {
    const typeSafeResponse: PaymentGatewayInitializeSession = {
      data: Success.ResponseDataSchema.parse({
        paypalClientId: this.pk,
        merchantClientId: this.merchantClientId,
        merchantId: this.merchantId,
        paymentMethodReadiness: this.paymentMethodReadiness,
        savedPaymentMethods: this.savedPaymentMethods.length > 0 ? this.savedPaymentMethods : undefined,
        userIdToken: this.userIdToken,
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
