import { err, ok, Result } from "neverthrow";

import { createLogger } from "@/logger";
import { AppConfigRepository } from "@/modules/app-config/app-config-repository";
import { TaxLookupRepository } from "@/modules/tax-lookups/tax-lookup-repository";
import { Zip2TaxClient } from "@/modules/zip2tax-client/zip2tax-client";
import { extractZip4FromAddress } from "@/modules/zip2tax-client/address-to-zip4";
import { taxLookupCache } from "@/lib/tax-lookup-cache";

const logger = createLogger("CalculateTaxesUseCase");

export interface TaxCalculationAddress {
  country: string;
  countryArea?: string | null;
  postalCode?: string | null;
  city?: string | null;
  streetAddress1?: string | null;
  streetAddress2?: string | null;
}

export interface TaxCalculationLineItem {
  unitPrice: number;
  totalPrice: number;
  quantity: number;
  productId?: string;
  variantId?: string;
  sku?: string;
}

export interface TaxCalculationRequest {
  billingAddress?: TaxCalculationAddress | null;
  shippingAddress?: TaxCalculationAddress | null;
  lines: TaxCalculationLineItem[];
  shippingPrice?: number;
  currency: string;
  pricesEnteredWithTax?: boolean;
}

export interface TaxCalculationLineResult {
  totalGrossMoney: {
    amount: number;
    currency: string;
  };
  totalNetMoney: {
    amount: number;
    currency: string;
  };
  taxRate: number;
}

export interface TaxCalculationResult {
  lines: TaxCalculationLineResult[];
  shippingPrice?: {
    totalGrossMoney: {
      amount: number;
      currency: string;
    };
    totalNetMoney: {
      amount: number;
      currency: string;
    };
    taxRate: number;
  };
}

export class CalculateTaxesUseCase {
  constructor(
    private readonly appConfigRepository: AppConfigRepository,
    private readonly taxLookupRepository: TaxLookupRepository,
    private readonly saleorApiUrl: string,
    private readonly appId: string
  ) {}

  async execute(request: TaxCalculationRequest): Promise<Result<TaxCalculationResult, Error>> {
    try {
      logger.info("Starting tax calculation", {
        currency: request.currency,
        linesCount: request.lines.length,
        hasBillingAddress: !!request.billingAddress,
        hasShippingAddress: !!request.shippingAddress,
        billingAddress: request.billingAddress,
        shippingAddress: request.shippingAddress,
      });

      // Get app config
      const configResult = await this.appConfigRepository.getConfig();
      if (configResult.isErr()) {
        logger.error("Failed to get app config", { error: configResult.error.message });
        return ok(this.createZeroTaxResult(request));
      }

      const config = configResult.value;

      // Check if tax calculation is enabled
      if (!config.enableTaxCalculation) {
        logger.info("Tax calculation is disabled in config");
        return ok(this.createZeroTaxResult(request));
      }

      // Determine the address to use for tax calculation (prefer billing, fallback to shipping)
      const taxAddress = request.billingAddress || request.shippingAddress;

      if (!taxAddress) {
        logger.warn("No address provided for tax calculation, returning zero taxes");
        return ok(this.createZeroTaxResult(request));
      }

      // Get tax rate for this address
      const taxRateResult = await this.getTaxRateForAddress(taxAddress, config);

      if (taxRateResult.isErr()) {
        logger.error("Failed to get tax rate", { error: taxRateResult.error.message });
        // Fallback to default tax rate or zero
        const fallbackRate = config.defaultTaxRate;
        logger.info("Using fallback tax rate", { fallbackRate, shippingTaxable: config.shippingTaxable });
        return ok(this.calculateWithTaxRate(request, fallbackRate, config.shippingTaxable));
      }

      const taxRate = taxRateResult.value;

      logger.info("Tax rate determined", {
        taxRate,
        shippingTaxable: config.shippingTaxable,
        currency: request.currency,
        pricesEnteredWithTax: request.pricesEnteredWithTax,
      });

      return ok(this.calculateWithTaxRate(request, taxRate, config.shippingTaxable));

    } catch (error) {
      logger.error("Error calculating taxes", { error });
      return err(error instanceof Error ? error : new Error("Unknown error"));
    }
  }

  /**
   * Get tax rate for an address using multi-tier approach:
   * 1. Extract ZIP code from address (5-digit or ZIP+4 if customer entered it)
   * 2. Check memory cache
   * 3. Check metadata storage
   * 4. Call Zip2Tax API
   * 5. Update shippingTaxable flag in config from Zip2Tax response
   */
  private async getTaxRateForAddress(
    address: TaxCalculationAddress,
    config: any
  ): Promise<Result<number, Error>> {
    try {
      // Step 1: Extract ZIP code from postal code field
      const extractResult = extractZip4FromAddress(address);

      if (extractResult.isErr()) {
        logger.error("Failed to extract ZIP code from address", {
          error: extractResult.error.message,
          address,
        });
        return err(extractResult.error);
      }

      const zip4 = extractResult.value;

      // Step 2: Check memory cache
      const cachedRate = await taxLookupCache.get(this.saleorApiUrl, this.appId, zip4);

      if (cachedRate !== null) {
        logger.info("Tax rate found in memory cache", { zip4, taxRate: cachedRate });
        return ok(cachedRate);
      }

      // Step 3: Check metadata storage
      const lookupResult = await this.taxLookupRepository.getLookup(zip4);

      if (lookupResult.isErr()) {
        logger.warn("Error checking metadata storage", {
          error: lookupResult.error.message,
        });
      } else if (lookupResult.value) {
        const taxRate = lookupResult.value.taxRate;
        logger.info("Tax rate found in metadata storage", { zip4, taxRate });

        // Store in memory cache
        await taxLookupCache.set(this.saleorApiUrl, this.appId, zip4, taxRate);

        return ok(taxRate);
      }

      // Step 4: Call Zip2Tax API
      logger.info("Tax rate not found in cache, calling Zip2Tax API", { zip4 });

      // Check if we have credentials
      if (!config.zip2taxUsername || !config.zip2taxPassword) {
        logger.error("Zip2Tax credentials not configured");
        return err(new Error("Zip2Tax credentials not configured"));
      }

      const client = new Zip2TaxClient(config.zip2taxUsername, config.zip2taxPassword);

      logger.info("Calling Zip2Tax API", { zip4 });
      const apiResult = await client.lookupTaxRate(zip4);

      if (apiResult.isErr()) {
        logger.error("Failed to lookup tax rate from Zip2Tax API", {
          error: apiResult.error.message,
          errorType: apiResult.error.constructor.name,
          zip4,
        });
        return err(apiResult.error);
      }

      const zip2TaxResponse = apiResult.value;
      const taxRate = zip2TaxResponse.taxRate;
      const shippingTaxable = zip2TaxResponse.shippingTaxable;

      logger.info("Tax rate received from Zip2Tax API", {
        zip4,
        taxRate,
        shippingTaxable,
        city: zip2TaxResponse.city,
        state: zip2TaxResponse.state,
        willCacheInMemory: true,
        willCacheInMetadata: true,
        metadataTTLDays: config.metadataTTLDays,
      });

      // Store tax rate in both caches
      await taxLookupCache.set(this.saleorApiUrl, this.appId, zip4, taxRate);
      await this.taxLookupRepository.saveLookup(zip4, taxRate, shippingTaxable, config.metadataTTLDays);

      // Update shippingTaxable flag in config if it changed
      if (config.shippingTaxable !== shippingTaxable) {
        logger.info("Updating shippingTaxable flag in config", {
          previousValue: config.shippingTaxable,
          newValue: shippingTaxable,
        });
        await this.appConfigRepository.updateConfig({ shippingTaxable });
      }

      return ok(taxRate);

    } catch (error) {
      logger.error("Error getting tax rate for address", { error, address });
      return err(error instanceof Error ? error : new Error("Unknown error"));
    }
  }

  /**
   * Calculate taxes using a specific tax rate
   */
  private calculateWithTaxRate(
    request: TaxCalculationRequest,
    taxRatePercent: number,
    shippingTaxable: boolean
  ): TaxCalculationResult {
    // Calculate taxes for each line
    const calculatedLines = request.lines.map(line =>
      this.calculateLineItemTax(line, taxRatePercent, request.currency, request.pricesEnteredWithTax)
    );

    // Calculate shipping tax if applicable
    let shippingPrice: TaxCalculationResult["shippingPrice"] | undefined;

    if (request.shippingPrice !== undefined && request.shippingPrice > 0) {
      const shippingTaxRate = shippingTaxable ? taxRatePercent : 0;
      const shippingNet = request.shippingPrice;
      const shippingTax = (shippingNet * shippingTaxRate) / 100;
      const shippingGross = shippingNet + shippingTax;

      shippingPrice = {
        totalNetMoney: {
          amount: shippingNet,
          currency: request.currency,
        },
        totalGrossMoney: {
          amount: shippingGross,
          currency: request.currency,
        },
        taxRate: shippingTaxRate,
      };

      logger.info("Shipping tax calculated", {
        shippingTaxable,
        shippingNet,
        shippingGross,
        shippingTax,
        shippingTaxRate,
      });
    }

    // Log detailed calculation results
    logger.info("Tax calculation completed", {
      taxRate: taxRatePercent,
      shippingTaxable,
      currency: request.currency,
      pricesEnteredWithTax: request.pricesEnteredWithTax,
      hasShipping: !!shippingPrice,
      results: calculatedLines.map(line => ({
        net: line.totalNetMoney.amount,
        gross: line.totalGrossMoney.amount,
        taxAmount: line.totalGrossMoney.amount - line.totalNetMoney.amount,
        taxRate: line.taxRate,
      }))
    });

    return {
      lines: calculatedLines,
      shippingPrice,
    };
  }

  private calculateLineItemTax(
    line: TaxCalculationLineItem,
    taxRatePercent: number,
    currency: string,
    pricesEnteredWithTax = false
  ): TaxCalculationLineResult {
    const taxRate = taxRatePercent / 100; // Convert percentage to decimal

    let totalNet: number;
    let totalGross: number;

    if (pricesEnteredWithTax) {
      // Price includes tax, calculate net price
      totalGross = line.totalPrice;
      totalNet = totalGross / (1 + taxRate);
    } else {
      // Price excludes tax, calculate gross price
      totalNet = line.totalPrice;
      totalGross = totalNet * (1 + taxRate);
    }

    return {
      totalGrossMoney: {
        amount: Math.round(totalGross * 100) / 100, // Round to 2 decimal places
        currency,
      },
      totalNetMoney: {
        amount: Math.round(totalNet * 100) / 100, // Round to 2 decimal places
        currency,
      },
      taxRate: taxRatePercent,
    };
  }

  private createZeroTaxResult(request: TaxCalculationRequest): TaxCalculationResult {
    return {
      lines: request.lines.map(line => ({
        totalGrossMoney: {
          amount: line.totalPrice,
          currency: request.currency,
        },
        totalNetMoney: {
          amount: line.totalPrice,
          currency: request.currency,
        },
        taxRate: 0,
      })),
    };
  }
}
