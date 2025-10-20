import { TRPCError } from "@trpc/server";
import { protectedClientProcedure } from "../trpc/protected-client-procedure";
import { router } from "../trpc/trpc-server";
import { TaxLookupRepository } from "./tax-lookup-repository";
import { manualLookupSchema } from "./tax-lookup-schema";
import { Zip2TaxClient } from "../zip2tax-client/zip2tax-client";
import { AppConfigRepository } from "../app-config/app-config-repository";
import { taxLookupCache } from "@/lib/tax-lookup-cache";
import { z } from "zod";

export const taxLookupsRouter = router({
  /**
   * Manually lookup a tax rate for a ZIP code
   * Used for testing and admin UI
   */
  manualLookup: protectedClientProcedure
    .input(manualLookupSchema)
    .mutation(async ({ ctx, input }) => {
      const repository = await TaxLookupRepository.fromAuthData(ctx.authData);
      const configRepository = await AppConfigRepository.fromAuthData(ctx.authData);

      // Get config for API credentials
      const configResult = await configRepository.getConfig();

      if (configResult.isErr()) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to get app configuration",
        });
      }

      const config = configResult.value;

      if (!config.zip2taxUsername || !config.zip2taxPassword) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Zip2Tax credentials not configured. Please configure your username and password.",
        });
      }

      // 1. Check memory cache
      const cachedRate = await taxLookupCache.get(
        ctx.authData.saleorApiUrl,
        ctx.authData.appId,
        input.zip
      );

      if (cachedRate !== null) {
        return {
          zip: input.zip,
          taxRate: cachedRate,
          cached: true,
        };
      }

      // 2. Check metadata storage
      const lookupResult = await repository.getLookup(input.zip);
      if (lookupResult.isOk() && lookupResult.value) {
        const taxRate = lookupResult.value.taxRate;

        // Warm memory cache
        await taxLookupCache.set(
          ctx.authData.saleorApiUrl,
          ctx.authData.appId,
          input.zip,
          taxRate
        );

        return {
          zip: input.zip,
          taxRate,
          cached: true,
        };
      }

      // 3. Call Zip2Tax API
      const client = new Zip2TaxClient(config.zip2taxUsername, config.zip2taxPassword);
      const result = await client.lookupTaxRate(input.zip);

      if (result.isErr()) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: result.error.message,
        });
      }

      const taxRate = result.value;

      // Save to metadata storage
      await repository.saveLookup(input.zip, taxRate, config.metadataTTLDays);

      // Cache in memory
      await taxLookupCache.set(ctx.authData.saleorApiUrl, ctx.authData.appId, input.zip, taxRate);

      return {
        zip: input.zip,
        taxRate,
        cached: true,
      };
    }),

  /**
   * Get cache statistics
   */
  getCacheStats: protectedClientProcedure.query(async ({ ctx }) => {
    const stats = taxLookupCache.getStats();
    const repository = await TaxLookupRepository.fromAuthData(ctx.authData);
    const lookupsResult = await repository.getAllLookups();

    const metadataCount = lookupsResult.isOk() ? lookupsResult.value.length : 0;

    return {
      memoryCache: {
        entries: stats.size,
        ttlMinutes: stats.ttlMinutes,
      },
      metadataStorage: {
        entries: metadataCount,
      },
    };
  }),

  /**
   * Clear all caches (memory and metadata)
   */
  clearCache: protectedClientProcedure.mutation(async ({ ctx }) => {
    const repository = await TaxLookupRepository.fromAuthData(ctx.authData);

    // Clear metadata storage
    const clearResult = await repository.clearAllLookups();

    if (clearResult.isErr()) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to clear cache",
      });
    }

    // Clear memory cache
    await taxLookupCache.invalidate(ctx.authData.saleorApiUrl, ctx.authData.appId);

    return { success: true };
  }),

  /**
   * Get all cached lookups (for debugging/admin view)
   */
  getAllLookups: protectedClientProcedure.query(async ({ ctx }) => {
    const repository = await TaxLookupRepository.fromAuthData(ctx.authData);
    const result = await repository.getAllLookups();

    if (result.isErr()) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: result.error.message,
      });
    }

    return result.value;
  }),

  /**
   * Delete a specific lookup by ZIP code
   */
  deleteLookup: protectedClientProcedure
    .input(z.object({ zip4: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const repository = await TaxLookupRepository.fromAuthData(ctx.authData);
      const result = await repository.deleteLookup(input.zip4);

      if (result.isErr()) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: result.error.message,
        });
      }

      // Also clear from memory cache
      await taxLookupCache.invalidateZip(ctx.authData.saleorApiUrl, ctx.authData.appId, input.zip4);

      return { success: true };
    }),
});
