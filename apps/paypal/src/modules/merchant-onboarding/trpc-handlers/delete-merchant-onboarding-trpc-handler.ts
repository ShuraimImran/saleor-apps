import { createGraphQLClient } from "@saleor/apps-shared/create-graphql-client";
import { captureException } from "@sentry/nextjs";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { getPool } from "@/lib/database";
import { createSettingsManager } from "@/lib/metadata-manager";
import { PayPalMultiConfigMetadataManager } from "@/modules/paypal/configuration/paypal-multi-config-metadata-manager";
import { createSaleorApiUrl } from "@/modules/saleor/saleor-api-url";
import { protectedClientProcedure } from "@/modules/trpc/protected-client-procedure";

import { PostgresMerchantOnboardingRepository } from "../merchant-onboarding-repository";

/**
 * tRPC Handler for deleting/disconnecting a merchant onboarding record
 * This completely removes the merchant connection from the database
 */
export class DeleteMerchantOnboardingTrpcHandler {
  baseProcedure = protectedClientProcedure;

  getTrpcProcedure() {
    return this.baseProcedure
      .input(
        z.object({
          trackingId: z.string().min(1),
        })
      )
      .mutation(async ({ input, ctx }) => {
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
          const pool = getPool();
          const repository = PostgresMerchantOnboardingRepository.create(pool);

          // Validate merchant exists before deletion
          const existingResult = await repository.getBySaleorApiUrl(saleorApiUrl.value);

          if (existingResult.isErr()) {
            captureException(existingResult.error);
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Failed to retrieve merchant record",
            });
          }

          if (!existingResult.value) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Merchant onboarding record not found",
            });
          }

          // Delete the merchant record
          const deleteResult = await repository.delete(saleorApiUrl.value, existingResult.value.trackingId);

          if (deleteResult.isErr()) {
            captureException(deleteResult.error);
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Failed to delete merchant onboarding record",
            });
          }

          // Clean up Saleor metadata (PayPal configs created during onboarding)
          if (ctx.appToken && ctx.appId) {
            try {
              const settingsManager = createSettingsManager(
                createGraphQLClient({
                  saleorApiUrl: ctx.saleorApiUrl,
                  token: ctx.appToken,
                }),
                ctx.appId
              );
              const metadataManager = new PayPalMultiConfigMetadataManager(settingsManager);
              const configsResult = await metadataManager.getAllConfigs();

              if (configsResult.isOk()) {
                for (const config of configsResult.value) {
                  await metadataManager.deleteConfig(config.id);
                }
              }

              // Invalidate PayPal config cache so storefront stops using old config
              const { paypalConfigCache } = await import("@/modules/paypal/configuration/paypal-config-cache");

              paypalConfigCache.invalidateAll(ctx.saleorApiUrl);
            } catch (error) {
              // Log but don't fail the disconnect — DB record is already deleted
              captureException(error);
            }
          }

          return {
            success: true,
            message: "Merchant disconnected successfully",
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
