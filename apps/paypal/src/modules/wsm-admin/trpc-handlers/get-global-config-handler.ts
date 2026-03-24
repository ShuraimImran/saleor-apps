import { TRPCError } from "@trpc/server";

import { getPool } from "@/lib/database";
import { publicProcedure } from "@/modules/trpc/public-procedure";

import { GlobalPayPalConfig } from "../global-paypal-config";
import { GlobalPayPalConfigRepository } from "../global-paypal-config-repository";
import { validateWsmAdminAuth } from "../wsm-admin-procedure";

function maskConfig(config: GlobalPayPalConfig) {
  return {
    id: config.id,
    clientId: config.clientId,
    clientSecret: "***" + config.clientSecret.slice(-4),
    partnerMerchantId: config.partnerMerchantId,
    partnerFeePercent: config.partnerFeePercent,
    bnCode: config.bnCode,
    webhookId: config.webhookId,
    webhookUrl: config.webhookUrl,
    environment: config.environment,
    createdAt: config.createdAt,
    updatedAt: config.updatedAt,
  };
}

/**
 * Get global PayPal configuration (WSM admin only)
 * Returns both SANDBOX and LIVE configs if they exist
 */
export class GetGlobalConfigHandler {
  baseProcedure = publicProcedure;

  getTrpcProcedure() {
    return this.baseProcedure.query(async ({ ctx }) => {
      validateWsmAdminAuth(ctx.cookieHeader);

      const repository = GlobalPayPalConfigRepository.create(getPool());
      const configsResult = await repository.getAllConfigs();

      if (configsResult.isErr()) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to load global configuration",
        });
      }

      const configs = configsResult.value;
      const sandboxConfig = configs.find((c) => c.environment === "SANDBOX") ?? null;
      const liveConfig = configs.find((c) => c.environment === "LIVE") ?? null;

      return {
        configured: configs.length > 0,
        sandboxConfig: sandboxConfig ? maskConfig(sandboxConfig) : null,
        liveConfig: liveConfig ? maskConfig(liveConfig) : null,
        config: configs.length > 0 ? maskConfig(configs[0]) : null,
      };
    });
  }
}
