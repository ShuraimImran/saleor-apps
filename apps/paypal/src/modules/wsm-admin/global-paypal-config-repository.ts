import { err,ok, Result } from "neverthrow";
import { Pool } from "pg";

import { createLogger } from "@/lib/logger";

import { GlobalPayPalConfig, PayPalEnvironment } from "./global-paypal-config";
import { globalPayPalConfigCache } from "./global-paypal-config-cache";

const logger = createLogger("GlobalPayPalConfigRepository");

const SELECT_COLUMNS = `id, client_id, client_secret, partner_merchant_id, partner_fee_percent, bn_code, webhook_id, webhook_url, environment, is_active, created_at, updated_at`;

function rowToConfig(row: Record<string, unknown>): Result<GlobalPayPalConfig, Error> {
  return GlobalPayPalConfig.create({
    id: row.id as string,
    clientId: row.client_id as string,
    clientSecret: row.client_secret as string,
    partnerMerchantId: row.partner_merchant_id as string | null,
    partnerFeePercent: row.partner_fee_percent as number | null,
    bnCode: row.bn_code as string | null,
    webhookId: row.webhook_id as string | null,
    webhookUrl: row.webhook_url as string | null,
    environment: row.environment as PayPalEnvironment,
    isActive: row.is_active as boolean,
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
  });
}

/**
 * Repository for managing global WSM PayPal configuration
 */
export class GlobalPayPalConfigRepository {
  private pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  static create(pool: Pool): GlobalPayPalConfigRepository {
    return new GlobalPayPalConfigRepository(pool);
  }

  /**
   * Get the global PayPal configuration for a specific environment
   * Uses in-memory cache to reduce database queries
   */
  async getConfigByEnvironment(environment: PayPalEnvironment): Promise<Result<GlobalPayPalConfig | null, Error>> {
    // Check cache first
    const cachedConfig = globalPayPalConfigCache.get(environment);

    if (cachedConfig !== null) {
      logger.debug("Returning cached global PayPal config", { environment });

      return ok(cachedConfig);
    }

    // Cache miss - fetch from database
    logger.debug("Cache miss - fetching global PayPal config from database", { environment });
    const startTime = Date.now();

    try {
      const query = `
        SELECT ${SELECT_COLUMNS}
        FROM wsm_global_paypal_config
        WHERE environment = $1 AND is_active = TRUE
        LIMIT 1
      `;

      const result = await this.pool.query(query, [environment]);
      const dbQueryTime = Date.now() - startTime;

      logger.debug("Database query completed", {
        environment,
        query_time_ms: dbQueryTime,
        rows_found: result.rows.length,
      });

      if (result.rows.length === 0) {
        // Cache the null result to avoid repeated DB queries
        globalPayPalConfigCache.set(environment, null);

        return ok(null);
      }

      const configResult = rowToConfig(result.rows[0]);

      if (configResult.isErr()) {
        return err(configResult.error);
      }

      // Cache the result
      globalPayPalConfigCache.set(environment, configResult.value);
      logger.debug("Global PayPal config cached successfully", { environment });

      return ok(configResult.value);
    } catch (error) {
      logger.error("Failed to get config from database", {
        environment,
        error: error instanceof Error ? error.message : String(error),
        query_time_ms: Date.now() - startTime,
      });

      return err(error instanceof Error ? error : new Error("Failed to get config by environment"));
    }
  }

  /**
   * @deprecated Use getConfigByEnvironment(environment) instead.
   * Kept for backward compatibility — returns the single active config (prefers LIVE, falls back to SANDBOX).
   */
  async getActiveConfig(): Promise<Result<GlobalPayPalConfig | null, Error>> {
    // Check cache first
    const cachedLive = globalPayPalConfigCache.get("LIVE");

    if (cachedLive !== null) {
      return ok(cachedLive);
    }

    const cachedSandbox = globalPayPalConfigCache.get("SANDBOX");

    if (cachedSandbox !== null) {
      return ok(cachedSandbox);
    }

    try {
      const query = `
        SELECT ${SELECT_COLUMNS}
        FROM wsm_global_paypal_config
        WHERE is_active = TRUE
        ORDER BY CASE environment WHEN 'LIVE' THEN 0 ELSE 1 END
        LIMIT 1
      `;

      const result = await this.pool.query(query);

      if (result.rows.length === 0) {
        return ok(null);
      }

      const configResult = rowToConfig(result.rows[0]);

      if (configResult.isErr()) {
        return err(configResult.error);
      }

      globalPayPalConfigCache.set(configResult.value.environment, configResult.value);

      return ok(configResult.value);
    } catch (error) {
      return err(error instanceof Error ? error : new Error("Failed to get active config"));
    }
  }

  /**
   * Get all active configs (one per environment)
   * Used by WSM admin UI to display both SANDBOX and LIVE configs
   */
  async getAllConfigs(): Promise<Result<GlobalPayPalConfig[], Error>> {
    try {
      const query = `
        SELECT ${SELECT_COLUMNS}
        FROM wsm_global_paypal_config
        WHERE is_active = TRUE
        ORDER BY environment
      `;

      const result = await this.pool.query(query);

      const configs: GlobalPayPalConfig[] = [];

      for (const row of result.rows) {
        const configResult = rowToConfig(row);

        if (configResult.isErr()) {
          return err(configResult.error);
        }

        configs.push(configResult.value);
      }

      return ok(configs);
    } catch (error) {
      return err(error instanceof Error ? error : new Error("Failed to get all configs"));
    }
  }

  /**
   * Create or update global PayPal configuration for a specific environment
   * Uses INSERT ... ON CONFLICT to upsert by environment
   * Invalidates cache for the affected environment only
   */
  async upsertConfig(data: {
    clientId: string;
    clientSecret: string;
    partnerMerchantId?: string | null;
    partnerFeePercent?: number | null;
    bnCode?: string | null;
    webhookId?: string | null;
    webhookUrl?: string | null;
    environment: PayPalEnvironment;
  }): Promise<Result<GlobalPayPalConfig, Error>> {
    try {
      const query = `
        INSERT INTO wsm_global_paypal_config (client_id, client_secret, partner_merchant_id, partner_fee_percent, bn_code, webhook_id, webhook_url, environment, is_active)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE)
        ON CONFLICT (environment) WHERE is_active = TRUE
        DO UPDATE SET
          client_id = EXCLUDED.client_id,
          client_secret = EXCLUDED.client_secret,
          partner_merchant_id = EXCLUDED.partner_merchant_id,
          partner_fee_percent = EXCLUDED.partner_fee_percent,
          bn_code = EXCLUDED.bn_code,
          webhook_id = COALESCE(EXCLUDED.webhook_id, wsm_global_paypal_config.webhook_id),
          webhook_url = COALESCE(EXCLUDED.webhook_url, wsm_global_paypal_config.webhook_url),
          updated_at = NOW()
        RETURNING ${SELECT_COLUMNS}
      `;

      const result = await this.pool.query(query, [
        data.clientId,
        data.clientSecret,
        data.partnerMerchantId ?? null,
        data.partnerFeePercent ?? null,
        data.bnCode ?? null,
        data.webhookId ?? null,
        data.webhookUrl ?? null,
        data.environment,
      ]);

      const configResult = rowToConfig(result.rows[0]);

      if (configResult.isErr()) {
        return err(configResult.error);
      }

      // Invalidate cache only for the affected environment
      globalPayPalConfigCache.invalidate(data.environment);
      logger.info("Cache invalidated due to config update", { environment: data.environment });

      return ok(configResult.value);
    } catch (error) {
      return err(error instanceof Error ? error : new Error("Failed to upsert config"));
    }
  }

  /**
   * Test if credentials are valid by attempting to get an OAuth token from PayPal
   */
  async testCredentials(data: {
    clientId: string;
    clientSecret: string;
    environment: PayPalEnvironment;
  }): Promise<Result<boolean, Error>> {
    try {
      const baseUrl =
        data.environment === "SANDBOX"
          ? "https://api-m.sandbox.paypal.com"
          : "https://api-m.paypal.com";

      const auth = Buffer.from(`${data.clientId}:${data.clientSecret}`).toString("base64");

      const response = await fetch(`${baseUrl}/v1/oauth2/token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${auth}`,
        },
        body: "grant_type=client_credentials",
      });

      if (!response.ok) {
        const errorText = await response.text();

        return err(new Error(`PayPal API error: ${response.status} - ${errorText}`));
      }

      const data_response = await response.json();

      if (data_response.access_token) {
        return ok(true);
      }

      return err(new Error("No access token received from PayPal"));
    } catch (error) {
      return err(error instanceof Error ? error : new Error("Failed to test credentials"));
    }
  }

  /**
   * Update webhook information for a specific environment's config
   * Used after webhook registration with PayPal
   */
  async updateWebhookInfo(data: {
    webhookId: string;
    webhookUrl: string;
    environment: PayPalEnvironment;
  }): Promise<Result<void, Error>> {
    try {
      const query = `
        UPDATE wsm_global_paypal_config
        SET webhook_id = $1, webhook_url = $2, updated_at = NOW()
        WHERE environment = $3 AND is_active = TRUE
      `;

      await this.pool.query(query, [data.webhookId, data.webhookUrl, data.environment]);

      // Invalidate cache for the affected environment
      globalPayPalConfigCache.invalidate(data.environment);
      logger.info("Webhook info updated for config", {
        environment: data.environment,
        webhookId: data.webhookId,
        webhookUrl: data.webhookUrl,
      });

      return ok(undefined);
    } catch (error) {
      logger.error("Failed to update webhook info", {
        error: error instanceof Error ? error.message : String(error),
      });

      return err(error instanceof Error ? error : new Error("Failed to update webhook info"));
    }
  }

  /**
   * Get count of connected tenants (for admin dashboard)
   */
  async getConnectedTenantsCount(): Promise<Result<number, Error>> {
    try {
      const query = `
        SELECT COUNT(DISTINCT saleor_api_url) as count
        FROM paypal_merchant_onboarding
        WHERE paypal_merchant_id IS NOT NULL
      `;

      const result = await this.pool.query(query);

      return ok(parseInt(result.rows[0].count, 10));
    } catch (error) {
      return err(error instanceof Error ? error : new Error("Failed to get tenants count"));
    }
  }
}
