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
import { protectedClientProcedure } from "@/modules/trpc/protected-client-procedure";
import { PostgresCustomerVaultRepository } from "../customer-vault-repository";

const logger = createLogger("CreateSetupTokenHandler");

const inputSchema = z.object({
  saleorUserId: z.string().min(1, "saleorUserId is required"),
  /**
   * Return URL after buyer approves the setup token
   * Required for redirect-based flows (e.g., 3DS verification)
   */
  returnUrl: z.string().url().optional(),
  /**
   * Cancel URL if buyer cancels the setup token approval
   */
  cancelUrl: z.string().url().optional(),
  /**
   * Brand name to display during card verification
   */
  brandName: z.string().optional(),
  /**
   * SCA verification method
   * - SCA_WHEN_REQUIRED: Only perform 3DS when required by card network
   * - SCA_ALWAYS: Always perform 3DS verification
   */
  verificationMethod: z.enum(["SCA_WHEN_REQUIRED", "SCA_ALWAYS"]).default("SCA_WHEN_REQUIRED"),
});

/**
 * tRPC Handler for creating a setup token (Vault Without Purchase)
 *
 * This enables "Save for Later" flow where buyers can save their card
 * without making a purchase. The flow is:
 *
 * 1. Frontend calls createSetupToken with saleorUserId
 * 2. Backend creates PayPal setup token with customer association
 * 3. Frontend renders Card Fields with the setup token
 * 4. Buyer enters card details and approves
 * 5. Frontend calls createPaymentTokenFromSetupToken to complete vaulting
 *
 * @see https://developer.paypal.com/docs/checkout/save-payment-methods/during-purchase/js-sdk/cards/
 */
export class CreateSetupTokenHandler {
  baseProcedure = protectedClientProcedure;

  getTrpcProcedure() {
    return this.baseProcedure.input(inputSchema).mutation(async ({ ctx, input }) => {
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
          input.saleorUserId
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
          saleorUserId: input.saleorUserId,
          paypalCustomerId,
        });

        // Create setup token via PayPal Vaulting API
        const vaultingApi = PayPalVaultingApi.create({
          clientId: createPayPalClientId(config.clientId),
          clientSecret: createPayPalClientSecret(config.clientSecret),
          merchantId: config.merchantId ? (config.merchantId as any) : undefined,
          merchantEmail: config.merchantEmail || undefined,
          env: config.environment as "SANDBOX" | "LIVE",
        });

        const setupTokenResult = await vaultingApi.createSetupToken({
          customerId: paypalCustomerId,
          paymentSource: {
            card: {
              verification_method: input.verificationMethod,
              experience_context: {
                brand_name: input.brandName,
                return_url: input.returnUrl,
                cancel_url: input.cancelUrl,
              },
            },
          },
        });

        if (setupTokenResult.isErr()) {
          logger.error("Failed to create setup token", {
            saleorUserId: input.saleorUserId,
            error: setupTokenResult.error,
          });
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to create setup token with PayPal",
          });
        }

        const setupToken = setupTokenResult.value;

        logger.info("Setup token created successfully", {
          saleorUserId: input.saleorUserId,
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
        };
      } catch (error) {
        if (error instanceof TRPCError) {
          throw error;
        }

        captureException(error);
        logger.error("Unexpected error creating setup token", {
          saleorUserId: input.saleorUserId,
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
