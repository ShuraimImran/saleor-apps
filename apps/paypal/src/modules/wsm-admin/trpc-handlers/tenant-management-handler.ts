import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { getPool } from "@/lib/database";
import { PayPalTenantConfigRepository } from "@/modules/app-config/repositories/paypal-tenant-config-repository";
import { publicProcedure } from "@/modules/trpc/public-procedure";

import { wsmAdminAuthSchema } from "./wsm-admin-input-schemas";

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
    return this.baseProcedure.input(wsmAdminAuthSchema).query(async ({ input }: { input: { secretKey: string } }) => {
      validateSuperAdminKey(input.secretKey);

      const repository = PayPalTenantConfigRepository.create(getPool());
      const result = await repository.listAll();

      if (result.isErr()) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to list tenants",
        });
      }

      return {
        tenants: result.value,
      };
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
        })
      )
      .mutation(async ({ input }) => {
        validateSuperAdminKey(input.secretKey);

        const repository = PayPalTenantConfigRepository.create(getPool());
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
