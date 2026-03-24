import { z } from "zod";

export const setGlobalConfigInputSchema = z.object({
  clientId: z.string().min(1, "Client ID is required"),
  clientSecret: z.string().min(1, "Client Secret is required"),
  partnerMerchantId: z.string().optional(),
  partnerFeePercent: z.number().min(0).max(100).optional(),
  bnCode: z.string().optional(),
  environment: z.enum(["SANDBOX", "LIVE"]),
});

export const testCredentialsInputSchema = z.object({
  clientId: z.string().min(1, "Client ID is required"),
  clientSecret: z.string().min(1, "Client Secret is required"),
  environment: z.enum(["SANDBOX", "LIVE"]),
});
