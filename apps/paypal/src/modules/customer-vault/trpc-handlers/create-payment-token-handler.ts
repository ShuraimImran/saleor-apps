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

const logger = createLogger("CreatePaymentTokenHandler");

const inputSchema = z.object({
  saleorUserId: z.string().min(1, "saleorUserId is required"),
  /**
   * The setup token ID returned from createSetupToken
   * Must be in APPROVED status before calling this endpoint
   */
  setupTokenId: z.string().min(1, "setupTokenId is required"),
});

/**
 * tRPC Handler for creating a payment token from an approved setup token
 * (Vault Without Purchase - Step 2)
 *
 * This completes the "Save for Later" flow:
 *
 * 1. Frontend called createSetupToken -> received setupTokenId
 * 2. Buyer entered card details via Card Fields
 * 3. Setup token status changed to APPROVED
 * 4. Frontend calls this endpoint with setupTokenId
 * 5. Backend converts setup token to permanent payment token
 * 6. Card is now vaulted and can be used for future purchases
 *
 * @see https://developer.paypal.com/docs/api/payment-tokens/v3/#payment-tokens_create
 */
export class CreatePaymentTokenHandler {
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

        // Verify customer has a vault mapping (security check)
        const pool = getPool();
        const customerVaultRepo = PostgresCustomerVaultRepository.create(pool);
        const customerVaultResult = await customerVaultRepo.getBySaleorUserId(
          saleorApiUrl.value,
          input.saleorUserId
        );

        if (customerVaultResult.isErr()) {
          captureException(customerVaultResult.error);
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to verify customer vault mapping",
          });
        }

        if (!customerVaultResult.value) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Customer vault mapping not found. Did you call createSetupToken first?",
          });
        }

        logger.info("Converting setup token to payment token", {
          saleorUserId: input.saleorUserId,
          setupTokenId: input.setupTokenId,
        });

        // Convert setup token to payment token via PayPal Vaulting API
        const vaultingApi = PayPalVaultingApi.create({
          clientId: createPayPalClientId(config.clientId),
          clientSecret: createPayPalClientSecret(config.clientSecret),
          merchantId: config.merchantId ? (config.merchantId as any) : undefined,
          merchantEmail: config.merchantEmail || undefined,
          env: config.environment as "SANDBOX" | "LIVE",
        });

        const paymentTokenResult = await vaultingApi.createPaymentTokenFromSetupToken({
          setupTokenId: input.setupTokenId,
        });

        if (paymentTokenResult.isErr()) {
          const error = paymentTokenResult.error as any;

          // Handle specific PayPal errors
          if (error?.statusCode === 422) {
            logger.warn("Setup token not approved or already used", {
              setupTokenId: input.setupTokenId,
              error,
            });
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message: "Setup token is not approved or has already been used",
            });
          }

          logger.error("Failed to create payment token from setup token", {
            saleorUserId: input.saleorUserId,
            setupTokenId: input.setupTokenId,
            error,
          });
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to create payment token with PayPal",
          });
        }

        const paymentToken = paymentTokenResult.value;

        logger.info("Payment token created successfully", {
          saleorUserId: input.saleorUserId,
          paymentTokenId: paymentToken.id,
          cardBrand: paymentToken.payment_source?.card?.brand,
          cardLastDigits: paymentToken.payment_source?.card?.last_digits,
        });

        // Return the vaulted card details
        return {
          paymentTokenId: paymentToken.id,
          customerId: paymentToken.customer.id,
          card: paymentToken.payment_source?.card
            ? {
                brand: paymentToken.payment_source.card.brand || "Unknown",
                lastDigits: paymentToken.payment_source.card.last_digits || "****",
                expiry: paymentToken.payment_source.card.expiry,
              }
            : null,
        };
      } catch (error) {
        if (error instanceof TRPCError) {
          throw error;
        }

        captureException(error);
        logger.error("Unexpected error creating payment token", {
          saleorUserId: input.saleorUserId,
          setupTokenId: input.setupTokenId,
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
