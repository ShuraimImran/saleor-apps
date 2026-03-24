import { z } from "zod";

import { getPool } from "@/lib/database";
import { publicProcedure } from "@/modules/trpc/public-procedure";

import { GlobalPayPalConfigRepository } from "../global-paypal-config-repository";
import { validateWsmAdminAuth } from "../wsm-admin-procedure";
import { testCredentialsInputSchema } from "./wsm-admin-input-schemas";

/**
 * Test PayPal credentials (WSM admin only)
 */
export class TestCredentialsHandler {
  baseProcedure = publicProcedure;

  getTrpcProcedure() {
    return this.baseProcedure.input(testCredentialsInputSchema).mutation(async ({ input, ctx }: { input: z.infer<typeof testCredentialsInputSchema>; ctx: any }) => {
      validateWsmAdminAuth(ctx.cookieHeader);

      const repository = GlobalPayPalConfigRepository.create(getPool());

      const testResult = await repository.testCredentials({
        clientId: input.clientId,
        clientSecret: input.clientSecret,
        environment: input.environment,
      });

      if (testResult.isErr()) {
        return {
          success: false,
          message: `Credentials are invalid: ${testResult.error.message}`,
        };
      }

      return {
        success: true,
        message: "Credentials are valid! Successfully authenticated with PayPal.",
      };
    });
  }
}
