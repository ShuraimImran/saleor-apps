import { captureException } from "@sentry/nextjs";
import { TRPCError } from "@trpc/server";

import { getPool } from "@/lib/database";
import { createLogger } from "@/lib/logger";
import { paypalConfigRepo } from "@/modules/paypal/configuration/paypal-config-repo";
import { PayPalVaultingApi } from "@/modules/paypal/paypal-vaulting-api";
import { createPayPalClientId } from "@/modules/paypal/paypal-client-id";
import { createPayPalClientSecret } from "@/modules/paypal/paypal-client-secret";
import { createSaleorApiUrl } from "@/modules/saleor/saleor-api-url";
import { protectedStorefrontProcedure } from "@/modules/trpc/protected-storefront-procedure";
import { PostgresCustomerVaultRepository } from "../customer-vault-repository";

const logger = createLogger("ListSavedPaymentMethodsHandler");

/**
 * tRPC Handler for listing saved payment methods (ACDC Card Vaulting - Phase 1)
 */
export class ListSavedPaymentMethodsHandler {
  baseProcedure = protectedStorefrontProcedure;

  getTrpcProcedure() {
    return this.baseProcedure.query(async ({ ctx }) => {
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
        // ctx.appToken is set by attachAppToken middleware
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

        // Check if customer has a vault mapping
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
            message: "Failed to get customer vault mapping",
          });
        }

        // No vault mapping = no saved cards
        if (!customerVaultResult.value) {
          return {
            savedPaymentMethods: [],
          };
        }

        const paypalCustomerId = customerVaultResult.value.paypalCustomerId;

        // Fetch saved payment methods from PayPal
        const vaultingApi = PayPalVaultingApi.create({
          clientId: createPayPalClientId(config.clientId),
          clientSecret: createPayPalClientSecret(config.clientSecret),
          merchantId: config.merchantId ? (config.merchantId as any) : undefined,
          merchantEmail: config.merchantEmail || undefined,
          env: config.environment as "SANDBOX" | "LIVE",
        });

        const paymentTokensResult = await vaultingApi.listPaymentTokens({
          customerId: paypalCustomerId,
        });

        if (paymentTokensResult.isErr()) {
          logger.warn("Failed to fetch payment tokens from PayPal", {
            error: paymentTokensResult.error,
          });
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to fetch saved payment methods from PayPal",
          });
        }

        const tokens = paymentTokensResult.value.payment_tokens || [];

        // Map PayPal payment tokens to response format (cards only for Phase 1)
        const savedPaymentMethods = tokens
          .filter(token => token.payment_source?.card)
          .map(token => ({
            id: token.id,
            type: "card" as const,
            card: {
              brand: token.payment_source.card?.brand || "Unknown",
              lastDigits: token.payment_source.card?.last_digits || "****",
              expiry: token.payment_source.card?.expiry,
            },
          }));

        logger.info("Listed saved payment methods", {
          saleorUserId: saleorUserId,
          count: savedPaymentMethods.length,
        });

        return {
          savedPaymentMethods,
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
