import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { getPool } from "@/lib/database";
import { PayPalTenantConfigRepository } from "@/modules/app-config/repositories/paypal-tenant-config-repository";
import { PostgresMerchantOnboardingRepository } from "@/modules/merchant-onboarding/merchant-onboarding-repository";
import { publicProcedure } from "@/modules/trpc/public-procedure";

import { GlobalPayPalConfigRepository } from "../global-paypal-config-repository";
import { wsmAdminAuthSchema } from "./wsm-admin-input-schemas";

/**
 * Set partner fee percent for a specific tenant
 */
export class SetTenantFeeHandler {
  baseProcedure = publicProcedure;

  getTrpcProcedure() {
    return this.baseProcedure
      .input(
        wsmAdminAuthSchema.extend({
          saleorApiUrl: z.string().min(1, "Saleor API URL is required"),
          partnerFeePercent: z.number().min(0).max(100),
        })
      )
      .mutation(async ({ input }) => {
        validateSuperAdminKey(input.secretKey);

        const repository = PayPalTenantConfigRepository.create(getPool());
        const result = await repository.setPartnerFeePercent({
          saleorApiUrl: input.saleorApiUrl,
          partnerFeePercent: input.partnerFeePercent,
        });

        if (result.isErr()) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `Failed to update partner fee: ${result.error.message}`,
          });
        }

        return {
          success: true,
          message: `Partner fee set to ${input.partnerFeePercent}% for ${input.saleorApiUrl}`,
        };
      });
  }
}

/**
 * Validate WSM super admin secret key
 */
function validateSuperAdminKey(secretKey: string) {
  const expectedKey = process.env.SUPER_ADMIN_SECRET_KEY;

  if (!expectedKey) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Super admin key not configured on server",
    });
  }

  if (secretKey !== expectedKey) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Invalid super admin secret key",
    });
  }
}

/**
 * List all tenants with their environment and live access status
 */
export class ListTenantsHandler {
  baseProcedure = publicProcedure;

  getTrpcProcedure() {
    return this.baseProcedure
      .input(
        wsmAdminAuthSchema.extend({
          search: z.string().optional(),
          filter: z.enum(["ALL", "SANDBOX", "LIVE"]).optional(),
          page: z.number().min(1).optional(),
          pageSize: z.number().min(1).max(100).optional(),
        })
      )
      .query(async ({ input }) => {
        validateSuperAdminKey(input.secretKey);

        const repository = PayPalTenantConfigRepository.create(getPool());
        const result = await repository.listAll({
          search: input.search,
          filter: input.filter,
          page: input.page,
          pageSize: input.pageSize,
        });

        if (result.isErr()) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to list tenants",
          });
        }

        return result.value;
      });
  }
}

/**
 * Toggle live access for a specific tenant
 */
export class SetTenantLiveAccessHandler {
  baseProcedure = publicProcedure;

  getTrpcProcedure() {
    return this.baseProcedure
      .input(
        wsmAdminAuthSchema.extend({
          saleorApiUrl: z.string().min(1, "Saleor API URL is required"),
          liveEnabled: z.boolean(),
          force: z.boolean().optional(),
        })
      )
      .mutation(async ({ input }) => {
        validateSuperAdminKey(input.secretKey);

        // If enabling live, check that LIVE global config exists
        if (input.liveEnabled) {
          const globalConfigRepo = GlobalPayPalConfigRepository.create(getPool());
          const liveConfigResult = await globalConfigRepo.getConfigByEnvironment("LIVE");

          if (liveConfigResult.isErr() || !liveConfigResult.value) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Cannot enable live access: No LIVE PayPal configuration found. Please configure production credentials first.",
            });
          }
        }

        const pool = getPool();

        // If disabling live, check for active production merchant
        if (!input.liveEnabled) {
          const onboardingRepo = PostgresMerchantOnboardingRepository.create(pool);
          const merchantResult = await onboardingRepo.getBySaleorApiUrl(input.saleorApiUrl);

          if (merchantResult.isOk() && merchantResult.value) {
            const merchant = merchantResult.value;
            const hasActiveLiveMerchant =
              merchant.environment === "LIVE" &&
              merchant.paypalMerchantId &&
              (merchant.onboardingStatus === "COMPLETED" || merchant.onboardingStatus === "IN_PROGRESS");

            if (hasActiveLiveMerchant && !input.force) {
              throw new TRPCError({
                code: "PRECONDITION_FAILED",
                message: "ACTIVE_LIVE_MERCHANT",
              });
            }

            // If force=true, disconnect the merchant and reset environment
            if (hasActiveLiveMerchant && input.force) {
              // Delete the merchant onboarding record
              await onboardingRepo.delete(input.saleorApiUrl, merchant.trackingId);

              // Invalidate PayPal config cache
              const { paypalConfigCache } = await import("@/modules/paypal/configuration/paypal-config-cache");

              paypalConfigCache.invalidateAll(input.saleorApiUrl);
            }
          }
        }

        const repository = PayPalTenantConfigRepository.create(pool);

        // If disabling live, also force environment back to SANDBOX
        if (!input.liveEnabled) {
          const upsertResult = await repository.upsert({
            saleorApiUrl: input.saleorApiUrl,
            environment: "SANDBOX",
            liveEnabled: false,
          });

          if (upsertResult.isErr()) {
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: `Failed to update tenant config: ${upsertResult.error.message}`,
            });
          }

          return {
            success: true,
            message: `Live access disabled and environment reset to SANDBOX for ${input.saleorApiUrl}`,
          };
        }

        const result = await repository.setLiveEnabled({
          saleorApiUrl: input.saleorApiUrl,
          liveEnabled: input.liveEnabled,
        });

        if (result.isErr()) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `Failed to update live access: ${result.error.message}`,
          });
        }

        return {
          success: true,
          message: `Live access ${input.liveEnabled ? "enabled" : "disabled"} for ${input.saleorApiUrl}`,
        };
      });
  }
}
