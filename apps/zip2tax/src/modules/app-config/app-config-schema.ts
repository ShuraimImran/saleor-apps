import { z } from "zod";

/**
 * Zip2Tax App Configuration Schema
 * Stores general app configuration settings
 */
export const appConfigSchema = z.object({
  /**
   * General app configuration
   */
  appName: z.string().default("Zip2Tax"),
  version: z.string().default("1.0.0"),

  /**
   * Zip2Tax API credentials
   */
  zip2taxUsername: z.string().default(""),
  zip2taxPassword: z.string().default(""),

  /**
   * Tax calculation settings
   */
  defaultTaxRate: z.number().min(0).max(100).default(0),
  enableTaxCalculation: z.boolean().default(true),
  shippingTaxable: z.boolean().default(false), // Populated from Zip2Tax response

  /**
   * Cache settings
   */
  cacheTTLMinutes: z.number().min(1).max(1440).default(15), // 1 minute to 24 hours
  metadataTTLDays: z.number().min(1).max(90).default(30), // 1 to 90 days

  /**
   * Debug and logging settings
   */
  debugMode: z.boolean().default(false),
  logLevel: z.enum(["error", "warn", "info", "debug"]).default("info"),
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
