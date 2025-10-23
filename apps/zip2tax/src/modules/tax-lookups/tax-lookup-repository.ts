import { AuthData } from "@saleor/app-sdk/APL";
import { SettingsManager } from "@saleor/app-sdk/settings-manager";
import { createGraphQLClient } from "@saleor/apps-shared/create-graphql-client";
import { EncryptedMetadataManagerFactory } from "@saleor/apps-shared/metadata-manager";
import { err, ok, Result } from "neverthrow";
import { createLogger } from "@/logger";
import { taxLookupCache } from "@/lib/tax-lookup-cache";
import {
  TaxLookupEntry,
  TaxLookupsCollection,
  createTaxLookupsCollection,
  createTaxLookupEntry,
  isLookupExpired,
  taxLookupsCollectionSchema,
} from "./tax-lookup-schema";
import {
  TaxLookupRepositoryError,
  TaxLookupNotFoundError,
  TaxLookupMetadataError,
} from "@/lib/errors/zip2tax-errors";

const logger = createLogger("TaxLookupRepository");

export class TaxLookupRepository {
  private readonly metadataKey = "zip2tax-lookups-v1";
  private settingsManager: SettingsManager;
  private saleorApiUrl: string;
  private appId: string;

  constructor(
    settingsManager: SettingsManager,
    saleorApiUrl: string,
    appId: string
  ) {
    this.settingsManager = settingsManager;
    this.saleorApiUrl = saleorApiUrl;
    this.appId = appId;
  }

  static async fromAuthData(authData: AuthData): Promise<TaxLookupRepository> {
    const client = createGraphQLClient({
      saleorApiUrl: authData.saleorApiUrl,
      token: authData.token,
    });

    const metadataManagerFactory = new EncryptedMetadataManagerFactory(
      process.env.SECRET_KEY || "CHANGE_ME_IN_PRODUCTION"
    );

    const settingsManager = metadataManagerFactory.create(client, authData.appId);

    return new TaxLookupRepository(
      settingsManager,
      authData.saleorApiUrl,
      authData.appId
    );
  }

  /**
   * Get all tax lookups from metadata storage
   */
  async getAllLookups(): Promise<Result<TaxLookupEntry[], Error>> {
    try {
      const metadata = await this.settingsManager.get(this.metadataKey);

      if (!metadata) {
        logger.info("No tax lookups found in metadata, returning empty array");
        return ok([]);
      }

      const parsed = JSON.parse(metadata);
      const collection = taxLookupsCollectionSchema.parse(parsed);

      // Filter out expired lookups
      const validLookups = collection.lookups.filter(
        (lookup) => !isLookupExpired(lookup)
      );

      // If we filtered out expired lookups, save the cleaned collection
      if (validLookups.length !== collection.lookups.length) {
        await this.pruneExpiredLookups();
      }

      return ok(validLookups);
    } catch (error) {
      logger.error("Failed to get tax lookups", { error });
      return err(
        new TaxLookupMetadataError(
          `Failed to fetch tax lookups: ${error instanceof Error ? error.message : String(error)}`
        )
      );
    }
  }

  /**
   * Get a specific tax lookup by ZIP+4 code
   */
  async getLookup(zip4: string): Promise<Result<TaxLookupEntry | null, Error>> {
    try {
      const allLookupsResult = await this.getAllLookups();

      if (allLookupsResult.isErr()) {
        return err(allLookupsResult.error);
      }

      const lookup = allLookupsResult.value.find((l) => l.zip4 === zip4);

      if (!lookup) {
        return ok(null);
      }

      // Double-check if expired
      if (isLookupExpired(lookup)) {
        return ok(null);
      }

      return ok(lookup);
    } catch (error) {
      logger.error("Failed to get tax lookup", { error, zip4 });
      return err(
        new TaxLookupRepositoryError(
          `Failed to get tax lookup for ${zip4}: ${error instanceof Error ? error.message : String(error)}`
        )
      );
    }
  }

  /**
   * Save or update a tax lookup
   */
  async saveLookup(
    zip4: string,
    taxRate: number,
    shippingTaxable: boolean,
    ttlDays: number = 30
  ): Promise<Result<TaxLookupEntry, Error>> {
    try {
      const allLookupsResult = await this.getAllLookups();

      if (allLookupsResult.isErr()) {
        return err(allLookupsResult.error);
      }

      const existingLookups = allLookupsResult.value;

      // Remove existing lookup for this ZIP if it exists
      const filteredLookups = existingLookups.filter((l) => l.zip4 !== zip4);

      // Create new lookup entry
      const newLookup = createTaxLookupEntry(zip4, taxRate, shippingTaxable, ttlDays);

      // Add new lookup
      const updatedLookups = [...filteredLookups, newLookup];

      // Save to metadata
      const collection: TaxLookupsCollection = {
        version: "1.0.0",
        lookups: updatedLookups,
        lastUpdated: new Date().toISOString(),
      };

      const serialized = JSON.stringify(collection);
      await this.settingsManager.set({ key: this.metadataKey, value: serialized });

      logger.info("Tax lookup saved successfully", { zip4, taxRate });

      // Invalidate cache
      await taxLookupCache.invalidate(this.saleorApiUrl, this.appId);

      return ok(newLookup);
    } catch (error) {
      logger.error("Failed to save tax lookup", { error, zip4 });
      return err(
        new TaxLookupMetadataError(
          `Failed to save tax lookup for ${zip4}: ${error instanceof Error ? error.message : String(error)}`
        )
      );
    }
  }

  /**
   * Delete a specific tax lookup
   */
  async deleteLookup(zip4: string): Promise<Result<void, Error>> {
    try {
      const allLookupsResult = await this.getAllLookups();

      if (allLookupsResult.isErr()) {
        return err(allLookupsResult.error);
      }

      const existingLookups = allLookupsResult.value;
      const filteredLookups = existingLookups.filter((l) => l.zip4 !== zip4);

      if (filteredLookups.length === existingLookups.length) {
        return err(
          new TaxLookupNotFoundError(`Tax lookup not found for ZIP: ${zip4}`)
        );
      }

      // Save updated collection
      const collection: TaxLookupsCollection = {
        version: "1.0.0",
        lookups: filteredLookups,
        lastUpdated: new Date().toISOString(),
      };

      const serialized = JSON.stringify(collection);
      await this.settingsManager.set({ key: this.metadataKey, value: serialized });

      logger.info("Tax lookup deleted successfully", { zip4 });

      // Invalidate cache
      await taxLookupCache.invalidate(this.saleorApiUrl, this.appId);

      return ok(undefined);
    } catch (error) {
      logger.error("Failed to delete tax lookup", { error, zip4 });
      return err(
        new TaxLookupMetadataError(
          `Failed to delete tax lookup for ${zip4}: ${error instanceof Error ? error.message : String(error)}`
        )
      );
    }
  }

  /**
   * Prune expired lookups from metadata storage
   */
  async pruneExpiredLookups(): Promise<Result<number, Error>> {
    try {
      const metadata = await this.settingsManager.get(this.metadataKey);

      if (!metadata) {
        return ok(0);
      }

      const parsed = JSON.parse(metadata);
      const collection = taxLookupsCollectionSchema.parse(parsed);

      const validLookups = collection.lookups.filter(
        (lookup) => !isLookupExpired(lookup)
      );

      const prunedCount = collection.lookups.length - validLookups.length;

      if (prunedCount > 0) {
        const updatedCollection: TaxLookupsCollection = {
          version: "1.0.0",
          lookups: validLookups,
          lastUpdated: new Date().toISOString(),
        };

        const serialized = JSON.stringify(updatedCollection);
        await this.settingsManager.set({ key: this.metadataKey, value: serialized });

        logger.info("Pruned expired tax lookups", { count: prunedCount });

        // Invalidate cache
        await taxLookupCache.invalidate(this.saleorApiUrl, this.appId);
      }

      return ok(prunedCount);
    } catch (error) {
      logger.error("Failed to prune expired lookups", { error });
      return err(
        new TaxLookupMetadataError(
          `Failed to prune expired lookups: ${error instanceof Error ? error.message : String(error)}`
        )
      );
    }
  }

  /**
   * Clear all tax lookups
   */
  async clearAllLookups(): Promise<Result<void, Error>> {
    try {
      logger.info("Clearing all tax lookups");

      const emptyCollection = createTaxLookupsCollection();
      const serialized = JSON.stringify(emptyCollection);

      await this.settingsManager.set({ key: this.metadataKey, value: serialized });

      // Invalidate cache
      await taxLookupCache.invalidate(this.saleorApiUrl, this.appId);

      logger.info("All tax lookups cleared successfully");

      return ok(undefined);
    } catch (error) {
      logger.error("Failed to clear tax lookups", { error });
      return err(
        new TaxLookupMetadataError(
          `Failed to clear tax lookups: ${error instanceof Error ? error.message : String(error)}`
        )
      );
    }
  }
}
