import { AuthData } from "@saleor/app-sdk/APL";
import { SettingsManager } from "@saleor/app-sdk/settings-manager";
import { createGraphQLClient } from "@saleor/apps-shared/create-graphql-client";
import { EncryptedMetadataManagerFactory } from "@saleor/apps-shared/metadata-manager";
import { err,ok, Result } from "neverthrow";
import { ulid } from "ulid";
import { taxRateCache } from "@/lib/tax-rate-cache";
import {
  createTaxRateId,
  CreateTaxRateRule,
  createTaxRatesCollection,
  TaxRateId,
  TaxRateRule,
  TaxRatesCollection,
  taxRatesCollectionSchema,
  UpdateTaxRateRule,
} from "./tax-rate-schema";

export class TaxRateRepository {
  private readonly metadataKey = "flat-tax-rates-v1";
  private settingsManager: SettingsManager;
  private saleorApiUrl: string;
  private appId: string;

  constructor(settingsManager: SettingsManager, saleorApiUrl: string, appId: string) {
    this.settingsManager = settingsManager;
    this.saleorApiUrl = saleorApiUrl;
    this.appId = appId;
  }

  static async fromAuthData(authData: AuthData): Promise<TaxRateRepository> {
    const client = createGraphQLClient({
      saleorApiUrl: authData.saleorApiUrl,
      token: authData.token,
    });

    const metadataManagerFactory = new EncryptedMetadataManagerFactory(
      process.env.SECRET_KEY || "CHANGE_ME_IN_PRODUCTION"
    );

    const settingsManager = metadataManagerFactory.create(client, authData.appId);

    return new TaxRateRepository(settingsManager, authData.saleorApiUrl, authData.appId);
  }

  async getAllRates(): Promise<Result<TaxRateRule[], Error>> {
    try {
      // Check cache first
      const cached = await taxRateCache.get(this.saleorApiUrl, this.appId);
      if (cached) {
        return ok(cached.taxRates);
      }

      // Cache miss - fetch from metadata
      const metadata = await this.settingsManager.get(this.metadataKey);

      if (!metadata) {
        return ok([]);
      }

      const parsed = JSON.parse(metadata);
      const collection = taxRatesCollectionSchema.parse(parsed);

      // Cache the result
      await taxRateCache.set(this.saleorApiUrl, this.appId, collection.rates, {} as any);

      return ok(collection.rates);
    } catch (error) {
      return err(error instanceof Error ? error : new Error('Failed to get tax rates'));
    }
  }

  async getById(id: TaxRateId): Promise<Result<TaxRateRule | null, Error>> {
    const allRatesResult = await this.getAllRates();
    
    if (allRatesResult.isErr()) {
      return err(allRatesResult.error);
    }

    const rate = allRatesResult.value.find(r => r.id === id);

    return ok(rate || null);
  }

  async createRate(data: CreateTaxRateRule): Promise<Result<TaxRateRule, Error>> {
    try {
      const allRatesResult = await this.getAllRates();

      if (allRatesResult.isErr()) {
        return err(allRatesResult.error);
      }

      const now = new Date().toISOString();
      const newRate: TaxRateRule = {
        ...data,
        id: createTaxRateId(),
        createdAt: now,
        updatedAt: now,
      };

      const updatedRates = [...allRatesResult.value, newRate];

      const saveResult = await this.saveAllRates(updatedRates);

      if (saveResult.isErr()) {
        return err(saveResult.error);
      }

      // Invalidate cache after successful create
      await taxRateCache.invalidate(this.saleorApiUrl, this.appId);

      return ok(newRate);
    } catch (error) {
      return err(error instanceof Error ? error : new Error('Failed to create tax rate'));
    }
  }

  async updateRate(data: UpdateTaxRateRule): Promise<Result<TaxRateRule, Error>> {
    try {
      const allRatesResult = await this.getAllRates();

      if (allRatesResult.isErr()) {
        return err(allRatesResult.error);
      }

      const existingRateIndex = allRatesResult.value.findIndex(r => r.id === data.id);

      if (existingRateIndex === -1) {
        return err(new Error('Tax rate not found'));
      }

      const existingRate = allRatesResult.value[existingRateIndex];
      const updatedRate: TaxRateRule = {
        ...existingRate,
        ...data,
        updatedAt: new Date().toISOString(),
      };

      const updatedRates = [...allRatesResult.value];
      updatedRates[existingRateIndex] = updatedRate;

      const saveResult = await this.saveAllRates(updatedRates);

      if (saveResult.isErr()) {
        return err(saveResult.error);
      }

      // Invalidate cache after successful update
      await taxRateCache.invalidate(this.saleorApiUrl, this.appId);

      return ok(updatedRate);
    } catch (error) {
      return err(error instanceof Error ? error : new Error('Failed to update tax rate'));
    }
  }

  async deleteRate(id: TaxRateId): Promise<Result<boolean, Error>> {
    try {
      const allRatesResult = await this.getAllRates();

      if (allRatesResult.isErr()) {
        return err(allRatesResult.error);
      }

      const rateExists = allRatesResult.value.some(r => r.id === id);

      if (!rateExists) {
        return err(new Error('Tax rate not found'));
      }

      const updatedRates = allRatesResult.value.filter(r => r.id !== id);
      const saveResult = await this.saveAllRates(updatedRates);

      if (saveResult.isErr()) {
        return err(saveResult.error);
      }

      // Invalidate cache after successful delete
      await taxRateCache.invalidate(this.saleorApiUrl, this.appId);

      return ok(true);
    } catch (error) {
      return err(error instanceof Error ? error : new Error('Failed to delete tax rate'));
    }
  }

  private async saveAllRates(rates: TaxRateRule[]): Promise<Result<void, Error>> {
    try {
      const collection = createTaxRatesCollection();
      collection.rates = rates;
      collection.lastUpdated = new Date().toISOString();
      
      const serialized = JSON.stringify(collection);

      await this.settingsManager.set({ key: this.metadataKey, value: serialized });

      return ok(undefined);
    } catch (error) {
      return err(error instanceof Error ? error : new Error('Failed to save tax rates'));
    }
  }
}