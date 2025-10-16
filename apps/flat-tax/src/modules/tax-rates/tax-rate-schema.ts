import { z } from "zod";

/**
 * Supported countries for tax calculation
 */
export const supportedCountrySchema = z.enum(["US", "CA", "MX"]);
export type SupportedCountry = z.infer<typeof supportedCountrySchema>;

/**
 * Tax Rate ID schema (branded string)
 */
export const taxRateIdSchema = z.string().brand("TaxRateId");
export type TaxRateId = z.infer<typeof taxRateIdSchema>;

/**
 * Create a new tax rate ID
 */
export function createTaxRateId(): TaxRateId {
  const { ulid } = require("ulid");
  return taxRateIdSchema.parse(`tax_rate_${ulid()}`);
}

/**
 * Base tax rate rule schema
 */
export const taxRateRuleSchema = z.object({
  id: taxRateIdSchema,
  name: z.string().min(1, "Name is required"),
  country: supportedCountrySchema,
  state: z.string().nullable(),
  postalCodePattern: z.string().nullable(),
  taxRate: z.number().min(0).max(100),
  enabled: z.boolean().default(true),
  priority: z.number().int().min(1).default(100),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type TaxRateRule = z.infer<typeof taxRateRuleSchema>;

/**
 * Schema for creating a new tax rate rule
 */
export const createTaxRateRuleSchema = taxRateRuleSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type CreateTaxRateRule = z.infer<typeof createTaxRateRuleSchema>;

/**
 * Schema for updating an existing tax rate rule
 */
export const updateTaxRateRuleSchema = createTaxRateRuleSchema.partial().extend({
  id: taxRateIdSchema,
});

export type UpdateTaxRateRule = z.infer<typeof updateTaxRateRuleSchema>;

/**
 * Tax rates collection schema for metadata storage
 */
export const taxRatesCollectionSchema = z.object({
  version: z.string().default("1.0.0"),
  rates: z.array(taxRateRuleSchema).default([]),
  lastUpdated: z.string().datetime(),
});

export type TaxRatesCollection = z.infer<typeof taxRatesCollectionSchema>;

/**
 * Create a new tax rates collection
 */
export function createTaxRatesCollection(): TaxRatesCollection {
  return taxRatesCollectionSchema.parse({
    version: "1.0.0",
    rates: [],
    lastUpdated: new Date().toISOString(),
  });
}

/**
 * tRPC input schemas
 */
export const createTaxRateSchema = createTaxRateRuleSchema;
export const updateTaxRateSchema = updateTaxRateRuleSchema;
