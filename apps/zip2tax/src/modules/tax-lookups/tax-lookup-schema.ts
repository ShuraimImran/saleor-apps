import { z } from "zod";

/**
 * Tax Lookup Entry Schema
 * Stores cached tax rate lookups by ZIP+4 code
 */
export const taxLookupEntrySchema = z.object({
  zip4: z.string(), // ZIP+4 code (e.g., "90210-3303" or "90210")
  taxRate: z.number().min(0).max(100), // Percentage (e.g., 9.5)
  shippingTaxable: z.boolean().default(false), // Whether shipping is taxable for this ZIP
  lookupDate: z.string().datetime(), // When this was looked up
  expiresAt: z.string().datetime(), // When this cache entry expires
});

export type TaxLookupEntry = z.infer<typeof taxLookupEntrySchema>;

/**
 * Tax Lookups Collection Schema
 * Stores all cached tax lookups in metadata
 */
export const taxLookupsCollectionSchema = z.object({
  version: z.string().default("1.0.0"),
  lookups: z.array(taxLookupEntrySchema).default([]),
  lastUpdated: z.string().datetime(),
});

export type TaxLookupsCollection = z.infer<typeof taxLookupsCollectionSchema>;

/**
 * Create a new tax lookups collection
 */
export function createTaxLookupsCollection(): TaxLookupsCollection {
  return taxLookupsCollectionSchema.parse({
    version: "1.0.0",
    lookups: [],
    lastUpdated: new Date().toISOString(),
  });
}

/**
 * Create a new tax lookup entry
 */
export function createTaxLookupEntry(
  zip4: string,
  taxRate: number,
  shippingTaxable: boolean,
  ttlDays: number = 30
): TaxLookupEntry {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1000);

  return taxLookupEntrySchema.parse({
    zip4,
    taxRate,
    shippingTaxable,
    lookupDate: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  });
}

/**
 * Check if a tax lookup entry is expired
 */
export function isLookupExpired(entry: TaxLookupEntry): boolean {
  const expiresAt = new Date(entry.expiresAt);
  const now = new Date();
  return now > expiresAt;
}

/**
 * Schema for manual lookup input (for testing/admin UI)
 */
export const manualLookupSchema = z.object({
  zip: z.string().min(5).max(10),
});

export type ManualLookup = z.infer<typeof manualLookupSchema>;
