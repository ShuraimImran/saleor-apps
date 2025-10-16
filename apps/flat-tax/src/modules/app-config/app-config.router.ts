import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { protectedClientProcedure } from "@/modules/trpc/protected-client-procedure";
import { router } from "@/modules/trpc/trpc-server";

import { AppConfigRepository } from "./app-config-repository";
import { updateAppConfigSchema } from "./app-config-schema";

export const appConfigRouter = router({
  // Get app configuration
  getConfig: protectedClientProcedure.query(async ({ ctx }) => {
    const repository = await AppConfigRepository.fromAuthData(ctx.authData);
    const result = await repository.getConfig();
    
    if (result.isErr()) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: result.error.message,
      });
    }
    
    return result.value;
  }),

  // Update app configuration
  updateConfig: protectedClientProcedure
    .input(updateAppConfigSchema)
    .mutation(async ({ input, ctx }) => {
      const repository = await AppConfigRepository.fromAuthData(ctx.authData);
      const result = await repository.updateConfig(input);
      
      if (result.isErr()) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: result.error.message,
        });
      }
      
      return result.value;
    }),
});
