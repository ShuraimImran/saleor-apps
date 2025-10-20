import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  APP_LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error"]).default("info"),
  APP_IFRAME_BASE_URL: z.string().url().optional(),
  APP_API_BASE_URL: z.string().url().optional(),
  SENTRY_DSN: z.string().optional(),
  SENTRY_ORG: z.string().optional(),
  SENTRY_PROJECT: z.string().optional(),
  SENTRY_AUTH_TOKEN: z.string().optional(),
  REST_APL_ENDPOINT: z.string().url().optional(),
  REST_APL_TOKEN: z.string().optional(),
});

export const env = envSchema.parse(process.env);