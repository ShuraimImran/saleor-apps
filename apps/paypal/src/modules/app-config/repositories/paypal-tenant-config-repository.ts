import { err, ok, Result } from "neverthrow";
import { Pool } from "pg";

import { createLogger } from "@/lib/logger";
import { PayPalEnvironment } from "@/modules/wsm-admin/global-paypal-config";

type PayPalTenantConfig = {
  softDescriptor?: string | null;
  environment: PayPalEnvironment;
};

const logger = createLogger("PayPalTenantConfigRepository");

export class PayPalTenantConfigRepository {
  private pool: Pool;

  private constructor(pool: Pool) {
    this.pool = pool;
  }

  static create(pool: Pool): PayPalTenantConfigRepository {
    return new PayPalTenantConfigRepository(pool);
  }

  async getBySaleorApiUrl(
    saleorApiUrl: string,
  ): Promise<Result<PayPalTenantConfig | null, Error>> {
    try {
      const query = `
        SELECT soft_descriptor, environment
        FROM paypal_tenant_config
        WHERE saleor_api_url = $1
        LIMIT 1
      `;
      const result = await this.pool.query(query, [saleorApiUrl]);

      if (result.rows.length === 0) {
        return ok(null);
      }

      return ok({
        softDescriptor: result.rows[0].soft_descriptor ?? undefined,
        environment: (result.rows[0].environment as PayPalEnvironment) ?? "SANDBOX",
      });
    } catch (error) {
      logger.error("Failed to fetch PayPal tenant config", {
        error: error instanceof Error ? error.message : String(error),
      });

      return err(error instanceof Error ? error : new Error("Failed to fetch PayPal tenant config"));
    }
  }

  async upsert(args: {
    saleorApiUrl: string;
    softDescriptor?: string | null;
    environment?: PayPalEnvironment;
  }): Promise<Result<void, Error>> {
    try {
      const query = `
        INSERT INTO paypal_tenant_config (saleor_api_url, soft_descriptor, environment)
        VALUES ($1, $2, $3)
        ON CONFLICT (saleor_api_url)
        DO UPDATE SET
          soft_descriptor = EXCLUDED.soft_descriptor,
          environment = EXCLUDED.environment,
          updated_at = NOW()
      `;

      await this.pool.query(query, [
        args.saleorApiUrl,
        args.softDescriptor ?? null,
        args.environment ?? "SANDBOX",
      ]);

      return ok(undefined);
    } catch (error) {
      logger.error("Failed to upsert PayPal tenant config", {
        error: error instanceof Error ? error.message : String(error),
      });

      return err(error instanceof Error ? error : new Error("Failed to upsert PayPal tenant config"));
    }
  }
}
