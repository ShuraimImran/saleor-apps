import { AuthData } from "@saleor/app-sdk/APL";
import { SettingsManager } from "@saleor/app-sdk/settings-manager";
import { createGraphQLClient } from "@saleor/apps-shared/create-graphql-client";
import { EncryptedMetadataManagerFactory } from "@saleor/apps-shared/metadata-manager";
import { err,ok, Result } from "neverthrow";
import {
  AppConfig,
  appConfigSchema,
  createDefaultAppConfig,
  UpdateAppConfig,
} from "./app-config-schema";

export class AppConfigRepository {
  private readonly metadataKey = "zip2tax-config-v1";
  private settingsManager: SettingsManager;

  constructor(settingsManager: SettingsManager) {
    this.settingsManager = settingsManager;
  }

  static async fromAuthData(authData: AuthData): Promise<AppConfigRepository> {
    const client = createGraphQLClient({
      saleorApiUrl: authData.saleorApiUrl,
      token: authData.token,
    });

    const metadataManagerFactory = new EncryptedMetadataManagerFactory(
      process.env.SECRET_KEY || "CHANGE_ME_IN_PRODUCTION"
    );

    const settingsManager = metadataManagerFactory.create(client, authData.appId);

    return new AppConfigRepository(settingsManager);
  }

  async getConfig(): Promise<Result<AppConfig, Error>> {
    try {
      const metadata = await this.settingsManager.get(this.metadataKey);
      
      if (!metadata) {
        return ok(createDefaultAppConfig());
      }

      const parsed = JSON.parse(metadata);
      const config = appConfigSchema.parse(parsed);
      
      return ok(config);
    } catch (error) {
      return err(error instanceof Error ? error : new Error('Failed to get app config'));
    }
  }

  async updateConfig(data: UpdateAppConfig): Promise<Result<AppConfig, Error>> {
    try {
      const currentConfigResult = await this.getConfig();
      
      if (currentConfigResult.isErr()) {
        return err(currentConfigResult.error);
      }

      const updatedConfig: AppConfig = {
        ...currentConfigResult.value,
        ...data,
      };

      const validated = appConfigSchema.parse(updatedConfig);
      const serialized = JSON.stringify(validated);
      
      await this.settingsManager.set({ key: this.metadataKey, value: serialized });

      return ok(validated);
    } catch (error) {
      return err(error instanceof Error ? error : new Error('Failed to update app config'));
    }
  }
}