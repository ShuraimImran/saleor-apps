import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { protectedClientProcedure } from "../trpc/protected-client-procedure";
import { router } from "../trpc/trpc-server";
import { TaxRateRepository } from "./tax-rate-repository";
import {
  createTaxRateSchema,
  taxRateIdSchema,
  updateTaxRateSchema,
} from "./tax-rate-schema";

export const taxRatesRouter = router({
  getAllRates: protectedClientProcedure.query(async ({ ctx }) => {
    if (!ctx.authData) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "No auth data provided",
      });
    }

    const repository = await TaxRateRepository.fromAuthData(ctx.authData);
    const result = await repository.getAllRates();

    if (result.isErr()) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to fetch tax rates",
        cause: result.error,
      });
    }

    return result.value;
  }),

  getRate: protectedClientProcedure
    .input(z.object({ id: taxRateIdSchema }))
    .query(async ({ ctx, input }) => {
      if (!ctx.authData) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "No auth data provided",
        });
      }
      
      const repository = await TaxRateRepository.fromAuthData(ctx.authData);
      
      const result = await repository.getById(input.id);

      if (result.isErr()) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Tax rate not found",
          cause: result.error,
        });
      }

      return result.value;
    }),

  createRate: protectedClientProcedure
    .input(createTaxRateSchema)
    .mutation(async ({ ctx, input }) => {
      if (!ctx.authData) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "No auth data provided",
        });
      }

      const repository = await TaxRateRepository.fromAuthData(ctx.authData);
      const result = await repository.createRate(input);

      if (result.isErr()) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Failed to create tax rate",
          cause: result.error,
        });
      }

      return result.value;
    }),

  updateRate: protectedClientProcedure
    .input(updateTaxRateSchema)
    .mutation(async ({ ctx, input }) => {
      if (!ctx.authData) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "No auth data provided",
        });
      }
      
      const repository = await TaxRateRepository.fromAuthData(ctx.authData);
      const result = await repository.updateRate(input);

      if (result.isErr()) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Failed to update tax rate",
          cause: result.error,
        });
      }

      return result.value;
    }),

  deleteRate: protectedClientProcedure
    .input(z.object({ id: taxRateIdSchema }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.authData) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "No auth data provided",
        });
      }
      
      const repository = await TaxRateRepository.fromAuthData(ctx.authData);
      const result = await repository.deleteRate(input.id);

      if (result.isErr()) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Failed to delete tax rate",
          cause: result.error,
        });
      }

      return { success: true };
    }),
});
