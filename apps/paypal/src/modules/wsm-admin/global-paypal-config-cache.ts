import { createLogger } from "@/lib/logger";

import { GlobalPayPalConfig, PayPalEnvironment } from "./global-paypal-config";

const logger = createLogger("GlobalPayPalConfigCache");

interface CacheEntry {
  config: GlobalPayPalConfig | null;
  timestamp: number;
}

/**
 * In-memory cache for global PayPal configuration
 * Stores one entry per environment (SANDBOX and LIVE independently)
 */
class GlobalPayPalConfigCache {
  private entries: Map<PayPalEnvironment, CacheEntry> = new Map();
  private readonly TTL_MS = 5 * 60 * 1000; // 5 minutes TTL

  /**
   * Get cached config for a specific environment, or null on cache miss
   */
  get(environment: PayPalEnvironment): GlobalPayPalConfig | null {
    const entry = this.entries.get(environment);

    if (!entry) {
      logger.debug("Cache miss: no cached config", { environment });

      return null;
    }

    const now = Date.now();
    const age = now - entry.timestamp;

    if (age > this.TTL_MS) {
      logger.debug("Cache miss: config expired", {
        environment,
        age_ms: age,
        ttl_ms: this.TTL_MS,
      });
      this.entries.delete(environment);

      return null;
    }

    logger.debug("Cache hit: returning cached config", {
      environment,
      age_ms: age,
      ttl_ms: this.TTL_MS,
    });

    return entry.config;
  }

  /**
   * Set config in cache for a specific environment
   */
  set(environment: PayPalEnvironment, config: GlobalPayPalConfig | null): void {
    this.entries.set(environment, {
      config,
      timestamp: Date.now(),
    });

    logger.debug("Config cached", {
      environment,
      has_config: !!config,
    });
  }

  /**
   * Invalidate cache for a specific environment, or all environments if none specified
   */
  invalidate(environment?: PayPalEnvironment): void {
    if (environment) {
      this.entries.delete(environment);
      logger.debug("Cache invalidated for environment", { environment });
    } else {
      this.entries.clear();
      logger.debug("Cache invalidated for all environments");
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    sandbox: { hasCachedConfig: boolean; cacheAge: number | null };
    live: { hasCachedConfig: boolean; cacheAge: number | null };
    ttl: number;
  } {
    const getEnvStats = (env: PayPalEnvironment) => {
      const entry = this.entries.get(env);

      return {
        hasCachedConfig: !!entry?.config,
        cacheAge: entry ? Date.now() - entry.timestamp : null,
      };
    };

    return {
      sandbox: getEnvStats("SANDBOX"),
      live: getEnvStats("LIVE"),
      ttl: this.TTL_MS,
    };
  }
}

// Singleton instance
export const globalPayPalConfigCache = new GlobalPayPalConfigCache();
