import { err, ok, Result } from "neverthrow";

import { createLogger } from "@/logger";
import { TaxRateRepository } from "@/modules/tax-rates/tax-rate-repository";
import { TaxRateRule } from "@/modules/tax-rates/tax-rate-schema";

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

interface MatchedTaxRule {
  rule: TaxRateRule;
  score: number;
}

export class CalculateTaxesUseCase {
  constructor(
    private readonly taxRateRepository: TaxRateRepository,
    private readonly saleorApiUrl: string,
    private readonly token: string
  ) {}

  async execute(request: TaxCalculationRequest): Promise<Result<TaxCalculationResult, Error>> {
    try {
      logger.info("Starting tax calculation", {
        currency: request.currency,
        linesCount: request.lines.length,
        hasBillingAddress: !!request.billingAddress,
        hasShippingAddress: !!request.shippingAddress,
      });

      // Get all tax rates
      const taxRatesResult = await this.taxRateRepository.getAllRates();

      if (taxRatesResult.isErr()) {
        return err(new Error(`Failed to fetch tax rates: ${taxRatesResult.error.message}`));
      }

      const taxRates = taxRatesResult.value.filter(rate => rate.enabled);

      // Determine the address to use for tax calculation (prefer billing, fallback to shipping)
      const taxAddress = request.billingAddress || request.shippingAddress;

      if (!taxAddress) {
        logger.warn("No address provided for tax calculation, returning zero taxes");
        return ok(this.createZeroTaxResult(request));
      }

      // Find the best matching tax rule
      const matchingRule = this.findBestMatchingRule(taxRates, taxAddress);

      if (!matchingRule) {
        logger.info("No matching tax rule found, returning zero taxes", {
          country: taxAddress.country,
          countryArea: taxAddress.countryArea,
          postalCode: taxAddress.postalCode,
        });
        return ok(this.createZeroTaxResult(request));
      }

      logger.info("Found matching tax rule", {
        ruleName: matchingRule.rule.name,
        taxRate: matchingRule.rule.taxRate,
        score: matchingRule.score,
      });

      // Calculate taxes for each line
      const calculatedLines = request.lines.map(line =>
        this.calculateLineItemTax(line, matchingRule.rule, request.currency, request.pricesEnteredWithTax)
      );

      // Log detailed calculation results
      logger.info("Tax calculation completed", {
        taxRate: matchingRule.rule.taxRate,
        currency: request.currency,
        pricesEnteredWithTax: request.pricesEnteredWithTax,
        results: calculatedLines.map(line => ({
          net: line.totalNetMoney.amount,
          gross: line.totalGrossMoney.amount,
          taxAmount: line.totalGrossMoney.amount - line.totalNetMoney.amount,
          taxRate: line.taxRate,
        }))
      });

      return ok({
        lines: calculatedLines,
        // TODO: Add shipping tax calculation if needed
      });

    } catch (error) {
      logger.error("Error calculating taxes", { error });
      return err(error instanceof Error ? error : new Error("Unknown error"));
    }
  }

  private findBestMatchingRule(taxRates: TaxRateRule[], address: TaxCalculationAddress): MatchedTaxRule | null {
    let bestMatch: MatchedTaxRule | null = null;

    for (const rule of taxRates) {
      const score = this.calculateMatchScore(rule, address);
      
      if (score > 0 && (!bestMatch || score > bestMatch.score)) {
        bestMatch = { rule, score };
      }
    }

    return bestMatch;
  }

  private calculateMatchScore(rule: TaxRateRule, address: TaxCalculationAddress): number {
    let score = 0;

    // Country match is required
    if (rule.country !== address.country) {
      return 0;
    }
    score += 1;

    // State/country area match (if rule specifies it)
    if (rule.state) {
      if (rule.state !== address.countryArea) {
        return 0;
      }
      score += 2;
    }

    // Postal code pattern match (if rule specifies it)
    if (rule.postalCodePattern && address.postalCode) {
      try {
        const regex = new RegExp(rule.postalCodePattern);
        if (!regex.test(address.postalCode)) {
          return 0;
        }
        score += 3;
      } catch (error) {
        logger.warn("Invalid postal code regex pattern", {
          pattern: rule.postalCodePattern,
          error: error instanceof Error ? error.message : String(error),
        });
        return 0;
      }
    }

    return score;
  }

  private calculateLineItemTax(
    line: TaxCalculationLineItem,
    rule: TaxRateRule,
    currency: string,
    pricesEnteredWithTax = false
  ): TaxCalculationLineResult {
    const taxRate = rule.taxRate / 100; // Convert percentage to decimal

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
      taxRate: rule.taxRate,
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
