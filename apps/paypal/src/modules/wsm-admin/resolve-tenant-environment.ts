import { Pool } from "pg";

import { createLogger } from "@/lib/logger";
import { PayPalTenantConfigRepository } from "@/modules/app-config/repositories/paypal-tenant-config-repository";

import { PayPalEnvironment } from "./global-paypal-config";

const logger = createLogger("resolveTenantEnvironment");

/**
 * Resolves the PayPal environment for a given tenant (Saleor instance).
 * Returns the tenant's configured environment, defaulting to SANDBOX if not set.
 */
export async function resolveTenantEnvironment(
  saleorApiUrl: string,
  pool: Pool,
): Promise<PayPalEnvironment> {
  const tenantConfigRepo = PayPalTenantConfigRepository.create(pool);
  const result = await tenantConfigRepo.getBySaleorApiUrl(saleorApiUrl);

  if (result.isOk() && result.value) {
    logger.debug("Resolved tenant environment", {
      saleorApiUrl,
      environment: result.value.environment,
    });

    return result.value.environment;
  }

  logger.debug("No tenant config found, defaulting to SANDBOX", { saleorApiUrl });

  return "SANDBOX";
}
