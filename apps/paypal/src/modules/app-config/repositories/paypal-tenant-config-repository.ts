import { err, ok, Result } from "neverthrow";
import { Pool } from "pg";

import { createLogger } from "@/lib/logger";
import { PayPalEnvironment } from "@/modules/wsm-admin/global-paypal-config";

type PayPalTenantConfig = {
  softDescriptor?: string | null;
  environment: PayPalEnvironment;
  liveEnabled: boolean;
  partnerFeePercent: number;
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
        SELECT soft_descriptor, environment, live_enabled, partner_fee_percent
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
        liveEnabled: result.rows[0].live_enabled ?? false,
        partnerFeePercent: parseFloat(result.rows[0].partner_fee_percent) || 0,
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
    liveEnabled?: boolean;
    partnerFeePercent?: number;
  }): Promise<Result<void, Error>> {
    try {
      const query = `
        INSERT INTO paypal_tenant_config (saleor_api_url, soft_descriptor, environment, live_enabled, partner_fee_percent)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (saleor_api_url)
        DO UPDATE SET
          soft_descriptor = EXCLUDED.soft_descriptor,
          environment = EXCLUDED.environment,
          live_enabled = CASE WHEN $6::boolean IS NULL THEN paypal_tenant_config.live_enabled ELSE $6::boolean END,
          partner_fee_percent = CASE WHEN $7::numeric IS NULL THEN paypal_tenant_config.partner_fee_percent ELSE $7::numeric END,
          updated_at = NOW()
      `;

      await this.pool.query(query, [
        args.saleorApiUrl,
        args.softDescriptor ?? null,
        args.environment ?? "SANDBOX",
        args.liveEnabled ?? false,
        args.partnerFeePercent ?? 0,
        args.liveEnabled ?? null,
        args.partnerFeePercent ?? null,
      ]);

      return ok(undefined);
    } catch (error) {
      logger.error("Failed to upsert PayPal tenant config", {
        error: error instanceof Error ? error.message : String(error),
      });

      return err(error instanceof Error ? error : new Error("Failed to upsert PayPal tenant config"));
    }
  }

  async setLiveEnabled(args: {
    saleorApiUrl: string;
    liveEnabled: boolean;
  }): Promise<Result<void, Error>> {
    try {
      const query = `
        UPDATE paypal_tenant_config
        SET live_enabled = $1, updated_at = NOW()
        WHERE saleor_api_url = $2
      `;

      const result = await this.pool.query(query, [args.liveEnabled, args.saleorApiUrl]);

      if (result.rowCount === 0) {
        // Tenant doesn't exist yet, create it
        return this.upsert({
          saleorApiUrl: args.saleorApiUrl,
          liveEnabled: args.liveEnabled,
        });
      }

      return ok(undefined);
    } catch (error) {
      logger.error("Failed to set live_enabled", {
        error: error instanceof Error ? error.message : String(error),
      });

      return err(error instanceof Error ? error : new Error("Failed to set live_enabled"));
    }
  }

  async setPartnerFeePercent(args: {
    saleorApiUrl: string;
    partnerFeePercent: number;
  }): Promise<Result<void, Error>> {
    try {
      const query = `
        UPDATE paypal_tenant_config
        SET partner_fee_percent = $1, updated_at = NOW()
        WHERE saleor_api_url = $2
      `;

      const result = await this.pool.query(query, [args.partnerFeePercent, args.saleorApiUrl]);

      if (result.rowCount === 0) {
        return this.upsert({
          saleorApiUrl: args.saleorApiUrl,
          partnerFeePercent: args.partnerFeePercent,
        });
      }

      return ok(undefined);
    } catch (error) {
      logger.error("Failed to set partner_fee_percent", {
        error: error instanceof Error ? error.message : String(error),
      });

      return err(error instanceof Error ? error : new Error("Failed to set partner_fee_percent"));
    }
  }

  async listAll(): Promise<Result<Array<{
    saleorApiUrl: string;
    environment: PayPalEnvironment;
    liveEnabled: boolean;
    partnerFeePercent: number;
    softDescriptor?: string | null;
  }>, Error>> {
    try {
      const query = `
        SELECT
          apl.tenant AS saleor_api_url,
          COALESCE(tc.environment, 'SANDBOX') AS environment,
          COALESCE(tc.live_enabled, FALSE) AS live_enabled,
          COALESCE(tc.partner_fee_percent, 0) AS partner_fee_percent,
          tc.soft_descriptor
        FROM saleor_app_configuration apl
        LEFT JOIN paypal_tenant_config tc ON tc.saleor_api_url = apl.tenant
        WHERE apl.is_active = TRUE
        ORDER BY apl.tenant
      `;

      const result = await this.pool.query(query);

      return ok(result.rows.map((row) => ({
        saleorApiUrl: row.saleor_api_url,
        environment: (row.environment as PayPalEnvironment) ?? "SANDBOX",
        liveEnabled: row.live_enabled ?? false,
        partnerFeePercent: parseFloat(row.partner_fee_percent) || 0,
        softDescriptor: row.soft_descriptor,
      })));
    } catch (error) {
      logger.error("Failed to list tenant configs", {
        error: error instanceof Error ? error.message : String(error),
      });

      return err(error instanceof Error ? error : new Error("Failed to list tenant configs"));
    }
  }
}
