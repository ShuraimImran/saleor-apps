import { captureException } from "@sentry/nextjs";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { getPool } from "@/lib/database";
import { createLogger } from "@/lib/logger";
import { paypalConfigRepo } from "@/modules/paypal/configuration/paypal-config-repo";
import { PayPalVaultingApi } from "@/modules/paypal/paypal-vaulting-api";
import { createPayPalClientId } from "@/modules/paypal/paypal-client-id";
import { createPayPalClientSecret } from "@/modules/paypal/paypal-client-secret";
import { createSaleorApiUrl } from "@/modules/saleor/saleor-api-url";
import { protectedStorefrontProcedure } from "@/modules/trpc/protected-storefront-procedure";
import { PostgresCustomerVaultRepository } from "../customer-vault-repository";

const logger = createLogger("CreateSetupTokenHandler");

/**
 * Payment method type for vault-without-purchase
 * Note: Apple Pay typically does not support vault-without-purchase
 */
const paymentMethodTypeSchema = z.enum(["card", "paypal", "venmo"]).default("card");

const inputSchema = z.object({
  /**
   * Payment method type to vault
   * - card: ACDC card vaulting
   * - paypal: PayPal wallet vaulting
   * - venmo: Venmo vaulting
   */
  paymentMethodType: paymentMethodTypeSchema,
  /**
   * Return URL after buyer approves the setup token
   * Required for redirect-based flows (e.g., 3DS verification, PayPal/Venmo approval)
   */
  returnUrl: z.string().url().optional(),
  /**
   * Cancel URL if buyer cancels the setup token approval
   */
  cancelUrl: z.string().url().optional(),
  /**
   * Brand name to display during verification
   */
  brandName: z.string().optional(),
  /**
   * SCA verification method (for cards only)
   * - SCA_WHEN_REQUIRED: Only perform 3DS when required by card network
   * - SCA_ALWAYS: Always perform 3DS verification
   */
  verificationMethod: z.enum(["SCA_WHEN_REQUIRED", "SCA_ALWAYS"]).default("SCA_WHEN_REQUIRED"),
  /**
   * Description for PayPal/Venmo vaulting (shown to buyer)
   */
  description: z.string().optional(),
  /**
   * Usage type for PayPal/Venmo vaulting
   * - MERCHANT: For merchant-initiated transactions
   * - PLATFORM: For platform-initiated transactions
   */
  usageType: z.enum(["MERCHANT", "PLATFORM"]).default("MERCHANT"),
});

/**
 * tRPC Handler for creating a setup token (Vault Without Purchase / RBM)
 *
 * This enables "Save for Later" flow where buyers can save their payment method
 * without making a purchase. Supports:
 * - Card (ACDC): Buyer enters card details via Card Fields
 * - PayPal: Buyer approves via PayPal redirect/popup
 * - Venmo: Buyer approves via Venmo redirect/popup
 *
 * Flow:
 * 1. Frontend calls createSetupToken with saleorUserId and paymentMethodType
 * 2. Backend creates PayPal setup token with customer association
 * 3. For cards: Frontend renders Card Fields with the setup token
 *    For PayPal/Venmo: Frontend redirects to approvalUrl or opens popup
 * 4. Buyer enters details/approves
 * 5. Frontend calls createPaymentTokenFromSetupToken to complete vaulting
 *
 * @see https://developer.paypal.com/docs/checkout/save-payment-methods/
 */
export class CreateSetupTokenHandler {
  baseProcedure = protectedStorefrontProcedure;

  getTrpcProcedure() {
    return this.baseProcedure.input(inputSchema).mutation(async ({ ctx, input }) => {
      const saleorUserId = ctx.saleorUserId as string;
      if (!ctx.saleorApiUrl) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Missing saleorApiUrl in request",
        });
      }

      const saleorApiUrl = createSaleorApiUrl(ctx.saleorApiUrl);
      if (saleorApiUrl.isErr()) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Malformed saleorApiUrl",
        });
      }

      try {
        // Get PayPal configuration
        const configResult = await paypalConfigRepo.getPayPalConfig({
          saleorApiUrl: ctx.saleorApiUrl!,
          token: ctx.appToken!,
          appId: ctx.appId!,
        });

        if (configResult.isErr() || !configResult.value) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "PayPal configuration not found",
          });
        }

        const config = configResult.value;

        // Get or create customer vault mapping
        const pool = getPool();
        const customerVaultRepo = PostgresCustomerVaultRepository.create(pool);
        const customerVaultResult = await customerVaultRepo.getOrCreate(
          saleorApiUrl.value,
          saleorUserId
        );

        if (customerVaultResult.isErr()) {
          captureException(customerVaultResult.error);
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to get/create customer vault mapping",
          });
        }

        const paypalCustomerId = customerVaultResult.value.paypalCustomerId;

        logger.info("Creating setup token for vault-without-purchase", {
          saleorUserId: saleorUserId,
          paypalCustomerId,
          paymentMethodType: input.paymentMethodType,
        });

        // Create setup token via PayPal Vaulting API
        const vaultingApi = PayPalVaultingApi.create({
          clientId: createPayPalClientId(config.clientId),
          clientSecret: createPayPalClientSecret(config.clientSecret),
          merchantId: config.merchantId ? (config.merchantId as any) : undefined,
          merchantEmail: config.merchantEmail || undefined,
          env: config.environment as "SANDBOX" | "LIVE",
        });

        // Build payment source based on payment method type
        let paymentSource: Parameters<typeof vaultingApi.createSetupToken>[0]["paymentSource"];

        if (input.paymentMethodType === "card") {
          paymentSource = {
            card: {
              verification_method: input.verificationMethod,
              experience_context: {
                brand_name: input.brandName,
                return_url: input.returnUrl,
                cancel_url: input.cancelUrl,
              },
            },
          };
        } else if (input.paymentMethodType === "paypal") {
          paymentSource = {
            paypal: {
              description: input.description,
              usage_type: input.usageType,
              experience_context: {
                brand_name: input.brandName,
                return_url: input.returnUrl,
                cancel_url: input.cancelUrl,
                shipping_preference: "NO_SHIPPING",
              },
            },
          };
        } else if (input.paymentMethodType === "venmo") {
          paymentSource = {
            venmo: {
              description: input.description,
              usage_type: input.usageType,
              experience_context: {
                brand_name: input.brandName,
                shipping_preference: "NO_SHIPPING",
              },
            },
          };
        } else {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Unsupported payment method type: ${input.paymentMethodType}`,
          });
        }

        const setupTokenResult = await vaultingApi.createSetupToken({
          customerId: paypalCustomerId,
          paymentSource,
        });

        if (setupTokenResult.isErr()) {
          logger.error("Failed to create setup token", {
            saleorUserId: saleorUserId,
            error: setupTokenResult.error,
          });
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to create setup token with PayPal",
          });
        }

        const setupToken = setupTokenResult.value;

        logger.info("Setup token created successfully", {
          saleorUserId: saleorUserId,
          setupTokenId: setupToken.id,
          status: setupToken.status,
        });

        // Extract approval URL if present (for redirect flows)
        const approvalUrl = setupToken.links?.find(link => link.rel === "approve")?.href;

        return {
          setupTokenId: setupToken.id,
          status: setupToken.status,
          approvalUrl,
          customerId: paypalCustomerId,
          paymentMethodType: input.paymentMethodType,
        };
      } catch (error) {
        if (error instanceof TRPCError) {
          throw error;
        }

        captureException(error);
        logger.error("Unexpected error creating setup token", {
          saleorUserId: saleorUserId,
          error: error instanceof Error ? error.message : String(error),
        });
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "An unexpected error occurred",
        });
      }
    });
  }
}
