import { captureException } from "@sentry/nextjs";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { getPool } from "@/lib/database";
import { createLogger } from "@/lib/logger";
import { paypalConfigRepo } from "@/modules/paypal/configuration/paypal-config-repo";
import { createPayPalClientId } from "@/modules/paypal/paypal-client-id";
import { createPayPalClientSecret } from "@/modules/paypal/paypal-client-secret";
import { PayPalVaultingApi } from "@/modules/paypal/paypal-vaulting-api";
import { createSaleorApiUrl } from "@/modules/saleor/saleor-api-url";
import { protectedStorefrontProcedure } from "@/modules/trpc/protected-storefront-procedure";

import { PostgresCustomerVaultRepository } from "../customer-vault-repository";

const logger = createLogger("DeleteSavedPaymentMethodHandler");

const inputSchema = z.object({
  paymentTokenId: z.string().min(1, "paymentTokenId is required"),
});

/**
 * tRPC Handler for deleting a saved payment method (ACDC Card Vaulting - Phase 1)
 */
export class DeleteSavedPaymentMethodHandler {
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
        /*
         * Get PayPal configuration
         * ctx.appToken is set by attachAppToken middleware
         */
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
          saleorUserId
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
            message: "Customer has no saved payment methods",
          });
        }

        // Delete the payment token from PayPal
        const vaultingApi = PayPalVaultingApi.create({
          clientId: createPayPalClientId(config.clientId),
          clientSecret: createPayPalClientSecret(config.clientSecret),
          merchantId: config.merchantId ? (config.merchantId as any) : undefined,
          merchantEmail: config.merchantEmail || undefined,
          env: config.environment as "SANDBOX" | "LIVE",
        });

        const deleteResult = await vaultingApi.deletePaymentToken({
          paymentTokenId: input.paymentTokenId,
        });

        if (deleteResult.isErr()) {
          logger.warn("Failed to delete payment token from PayPal", {
            paymentTokenId: input.paymentTokenId,
            error: deleteResult.error,
          });
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to delete saved payment method from PayPal",
          });
        }

        logger.info("Deleted saved payment method", {
          saleorUserId: saleorUserId,
          paymentTokenId: input.paymentTokenId,
        });

        return {
          success: true,
          deletedPaymentTokenId: input.paymentTokenId,
        };
      } catch (error) {
        if (error instanceof TRPCError) {
          throw error;
        }

        captureException(error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "An unexpected error occurred",
        });
      }
    });
  }
}
