// Simple Map-based cache for tax lookups by ZIP+4
interface TaxLookupCacheEntry {
  taxRate: number;
  timestamp: number;
}

class TaxLookupCache {
  private cache: Map<string, TaxLookupCacheEntry> = new Map();
  private ttlMs: number;

  constructor(options: { ttlMs?: number } = {}) {
    this.ttlMs = options.ttlMs || 15 * 60 * 1000; // 15 minutes default
  }

  /**
   * Generate cache key from Saleor API URL, app ID, and ZIP+4
   */
  private getCacheKey(saleorApiUrl: string, appId: string, zip4: string): string {
    return `${saleorApiUrl}#${appId}#zip:${zip4}`;
  }

  /**
   * Check if cache entry is still valid
   */
  private isEntryValid(entry: TaxLookupCacheEntry): boolean {
    const now = Date.now();
    return (now - entry.timestamp) < this.ttlMs;
  }

  /**
   * Get cached tax rate for a ZIP+4
   */
  async get(saleorApiUrl: string, appId: string, zip4: string): Promise<number | null> {
    const key = this.getCacheKey(saleorApiUrl, appId, zip4);

    try {
      const entry = this.cache.get(key);

      if (!entry || !this.isEntryValid(entry)) {
        // Remove expired entry
        this.cache.delete(key);
        return null;
      }

      return entry.taxRate;
    } catch {
      // Cache miss or error
      return null;
    }
  }

  /**
   * Set cache entry for a ZIP+4
   */
  async set(
    saleorApiUrl: string,
    appId: string,
    zip4: string,
    taxRate: number
  ): Promise<void> {
    const key = this.getCacheKey(saleorApiUrl, appId, zip4);
    const entry: TaxLookupCacheEntry = {
      taxRate,
      timestamp: Date.now(),
    };

    this.cache.set(key, entry);
  }

  /**
   * Invalidate cache for specific instance (all ZIP lookups)
   */
  async invalidate(saleorApiUrl: string, appId: string): Promise<void> {
    const prefix = `${saleorApiUrl}#${appId}#zip:`;

    // Remove all entries for this instance
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Invalidate cache for a specific ZIP+4
   */
  async invalidateZip(saleorApiUrl: string, appId: string, zip4: string): Promise<void> {
    const key = this.getCacheKey(saleorApiUrl, appId, zip4);
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
      ttlMs: this.ttlMs,
      ttlMinutes: Math.round(this.ttlMs / 60000),
    };
  }

  /**
   * Set TTL dynamically (useful for configuration changes)
   */
  setTTL(ttlMinutes: number): void {
    this.ttlMs = ttlMinutes * 60 * 1000;
  }
}

// Export singleton instance
export const taxLookupCache = new TaxLookupCache();

// Export class for testing
export { TaxLookupCache };