import { captureException } from "@sentry/nextjs";
import { TRPCError } from "@trpc/server";

import { createLogger } from "@/lib/logger";
import { paypalConfigRepo } from "@/modules/paypal/configuration/paypal-config-repo";
import { PayPalClient } from "@/modules/paypal/paypal-client";
import { createPayPalClientId } from "@/modules/paypal/paypal-client-id";
import { createPayPalClientSecret } from "@/modules/paypal/paypal-client-secret";
import { protectedStorefrontProcedure } from "@/modules/trpc/protected-storefront-procedure";

const logger = createLogger("GenerateClientTokenHandler");

/**
 * tRPC Handler for generating a PayPal Client Token for JS SDK v6.
 *
 * The v6 SDK requires a server-generated client token (not the clientId)
 * to initialize on the frontend via `paypal.createInstance({ clientToken })`.
 * This keeps the clientId server-side only.
 */
export class GenerateClientTokenHandler {
  baseProcedure = protectedStorefrontProcedure;

  getTrpcProcedure() {
    return this.baseProcedure.query(async ({ ctx }) => {
      if (!ctx.saleorApiUrl) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Missing saleorApiUrl in request",
        });
      }

      try {
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

        const paypalClient = PayPalClient.create({
          clientId: createPayPalClientId(config.clientId),
          clientSecret: createPayPalClientSecret(config.clientSecret),
          merchantId: config.merchantId ? (config.merchantId as any) : undefined,
          merchantEmail: config.merchantEmail || undefined,
          env: config.environment as "SANDBOX" | "LIVE",
        });

        const clientToken = await paypalClient.generateClientToken();

        logger.info("Client token generated for SDK v6");

        return {
          clientToken,
        };
      } catch (error) {
        if (error instanceof TRPCError) {
          throw error;
        }

        captureException(error);
        logger.error("Unexpected error generating client token", {
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
