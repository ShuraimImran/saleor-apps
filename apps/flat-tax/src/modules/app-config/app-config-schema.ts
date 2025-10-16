import { z } from "zod";

/**
 * Flat Tax App Configuration Schema
 * Stores general app configuration settings
 */
export const appConfigSchema = z.object({
  /**
   * General app configuration
   */
  appName: z.string().default("Flat Tax"),
  version: z.string().default("1.0.0"),
  
  /**
   * Tax calculation settings
   */
  defaultTaxRate: z.number().min(0).max(100).default(0),
  enableTaxCalculation: z.boolean().default(true),
  
  /**
   * Debug and logging settings
   */
  debugMode: z.boolean().default(false),
  logLevel: z.enum(["error", "warn", "info", "debug"]).default("info"),
  
  /**
   * Feature flags
   */
  features: z.object({
    postalCodeRules: z.boolean().default(true),
    stateRules: z.boolean().default(true),
    countryRules: z.boolean().default(true),
  }).default({}),
});

export type AppConfig = z.infer<typeof appConfigSchema>;

/**
 * Schema for updating app configuration
 * All fields are optional for partial updates
 */
export const updateAppConfigSchema = appConfigSchema.partial();

export type UpdateAppConfig = z.infer<typeof updateAppConfigSchema>;

/**
 * Creates a default app configuration
 */
export function createDefaultAppConfig(): AppConfig {
  return appConfigSchema.parse({});
}

/**
 * Input schema for creating new app configuration
 */
export const createAppConfigSchema = appConfigSchema.omit({
  // Remove any computed fields if added later
});

export type CreateAppConfig = z.infer<typeof createAppConfigSchema>;
