import { APL, AplConfiguredResult, AplReadyResult, AuthData } from "@saleor/app-sdk/APL";

import { getPool } from "./database";

export class PostgresAPL implements APL {
  private appName: string;

  constructor(appName: string = "FlatTax") {
    this.appName = appName;
  }

  /**
   * Normalize URL to handle localhost vs 127.0.0.1 differences
   */
  private normalizeUrl(url: string): string {
    // Replace localhost with 127.0.0.1 for consistency
    return url.replace('localhost', '127.0.0.1');
  }

  async get(saleorApiUrl: string): Promise<AuthData | undefined> {
    try {
      const normalizedUrl = this.normalizeUrl(saleorApiUrl);
      const pool = getPool();

      // Try exact match first
      let result = await pool.query(
        "SELECT configurations FROM saleor_app_configuration WHERE tenant = $1 AND app_name = $2 AND is_active = TRUE",
        [saleorApiUrl, this.appName]
      );

      // If not found, try normalized URL
      if (result.rows.length === 0 && normalizedUrl !== saleorApiUrl) {
        result = await pool.query(
          "SELECT configurations FROM saleor_app_configuration WHERE tenant = $1 AND app_name = $2 AND is_active = TRUE",
          [normalizedUrl, this.appName]
        );
      }

      if (result.rows.length === 0) {
        return undefined;
      }

      return result.rows[0].configurations as AuthData;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(`PostgresAPL GET error for ${saleorApiUrl}:`, error);
      throw error;
    }
  }

  async set(authData: AuthData): Promise<void> {
    try {
      const pool = getPool();
      const normalizedUrl = this.normalizeUrl(authData.saleorApiUrl);

      // Always store with normalized URL for consistency
      const normalizedAuthData = {
        ...authData,
        saleorApiUrl: normalizedUrl,
      };

      await pool.query(
        `INSERT INTO saleor_app_configuration (tenant, app_name, configurations, updated_at, is_active)
         VALUES ($1, $2, $3, NOW(), TRUE)
         ON CONFLICT (tenant, app_name)
         DO UPDATE SET configurations = $3, updated_at = NOW(), is_active = TRUE`,
        [normalizedUrl, this.appName, JSON.stringify(normalizedAuthData)]
      );
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(`PostgresAPL SET error for ${authData.saleorApiUrl}:`, error);
      throw error;
    }
  }

  async delete(saleorApiUrl: string): Promise<void> {
    try {
      const pool = getPool();

      await pool.query(
        "UPDATE saleor_app_configuration SET is_active = FALSE, updated_at = NOW() WHERE tenant = $1 AND app_name = $2",
        [saleorApiUrl, this.appName]
      );
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(`PostgresAPL DELETE error for ${saleorApiUrl}:`, error);
      throw error;
    }
  }

  async getAll(): Promise<AuthData[]> {
    try {
      const pool = getPool();

      const result = await pool.query(
        "SELECT configurations FROM saleor_app_configuration WHERE app_name = $1 AND is_active = TRUE",
        [this.appName]
      );

      return result.rows.map((row) => row.configurations as AuthData);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(`PostgresAPL GET_ALL error:`, error);
      throw error;
    }
  }

  async isReady(): Promise<AplReadyResult> {
    try {
      const pool = getPool();

      await pool.query("SELECT 1");

      return { ready: true };
    } catch (error) {
      return {
        ready: false,
        error: error instanceof Error ? error : new Error("Unknown database error"),
      };
    }
  }

  async isConfigured(): Promise<AplConfiguredResult> {
    const requiredEnvVars = ["DB_HOST", "DB_NAME", "DB_USER", "DB_PASSWORD"];
    const missingVars = requiredEnvVars.filter((varName) => !process.env[varName]);

    if (missingVars.length > 0) {
      return {
        configured: false,
        error: new Error(`Missing required environment variables: ${missingVars.join(", ")}`),
      };
    }

    return { configured: true };
  }
}