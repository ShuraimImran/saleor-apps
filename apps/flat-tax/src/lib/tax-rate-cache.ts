// Simple Map-based cache instead of async-lru
import { AppConfig } from "@/modules/app-config/app-config-schema";
import { TaxRateRule } from "@/modules/tax-rates/tax-rate-schema";

interface CacheEntry {
  taxRates: TaxRateRule[];
  appConfig: AppConfig;
  timestamp: number;
}

class TaxRateCache {
  private cache: Map<string, CacheEntry> = new Map();
  private ttlMs: number;

  constructor(options: { maxSize?: number; ttlMs?: number } = {}) {
    this.ttlMs = options.ttlMs || 5 * 60 * 1000; // 5 minutes default
  }

  /**
   * Generate cache key from Saleor API URL and app ID
   */
  private getCacheKey(saleorApiUrl: string, appId: string): string {
    return `${saleorApiUrl}#${appId}`;
  }

  /**
   * Check if cache entry is still valid
   */
  private isEntryValid(entry: CacheEntry): boolean {
    const now = Date.now();

    return (now - entry.timestamp) < this.ttlMs;
  }

  /**
   * Get cached tax rates and app config
   */
  async get(saleorApiUrl: string, appId: string): Promise<CacheEntry | null> {
    const key = this.getCacheKey(saleorApiUrl, appId);
    
    try {
      const entry = await this.cache.get(key);
      
      if (!entry || !this.isEntryValid(entry)) {
        // Remove expired entry
        this.cache.delete(key);

        return null;
      }
      
      return entry;
    } catch {
      // Cache miss or error
      return null;
    }
  }

  /**
   * Set cache entry
   */
  async set(
    saleorApiUrl: string, 
    appId: string, 
    taxRates: TaxRateRule[], 
    appConfig: AppConfig
  ): Promise<void> {
    const key = this.getCacheKey(saleorApiUrl, appId);
    const entry: CacheEntry = {
      taxRates,
      appConfig,
      timestamp: Date.now(),
    };
    
    this.cache.set(key, entry);
  }

  /**
   * Invalidate cache for specific instance
   */
  async invalidate(saleorApiUrl: string, appId: string): Promise<void> {
    const key = this.getCacheKey(saleorApiUrl, appId);

    this.cache.delete(key);
  }

  /**
   * Clear entire cache
   */
  async clear(): Promise<void> {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   */
  getStats() {
    return {
      size: this.cache.size,
      maxSize: 100, // Fixed size for Map
      ttlMs: this.ttlMs,
    };
  }
}

// Export singleton instance
export const taxRateCache = new TaxRateCache();

// Export class for testing
export { TaxRateCache };