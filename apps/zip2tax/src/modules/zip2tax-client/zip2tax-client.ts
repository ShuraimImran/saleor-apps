import { err, ok, Result } from "neverthrow";
import { createLogger } from "@/logger";
import {
  Zip2TaxAPIError,
  Zip2TaxAuthError,
  Zip2TaxTimeoutError,
  Zip2TaxRateLimitError,
} from "@/lib/errors/zip2tax-errors";

const logger = createLogger("Zip2TaxClient");

const ZIP2TAX_API_URL = "https://api.zip2tax.com/TaxRate-USA.json";
const DEFAULT_TIMEOUT_MS = 5000; // 5 seconds
const MAX_RETRIES = 1;

export interface Zip2TaxResponse {
  zip: string;
  taxRate: number;
  shippingTaxable: boolean;
  city?: string;
  county?: string;
  state?: string;
}

export class Zip2TaxClient {
  constructor(
    private readonly username: string,
    private readonly password: string,
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS
  ) {
    if (!username || !password) {
      throw new Error("Zip2Tax username and password are required");
    }
  }

  /**
   * Lookup tax rate for a given ZIP or ZIP+4 code
   * @param zip - ZIP code (5 or 9 digits with hyphen, e.g., "90210" or "90210-3303")
   * @returns Tax rate and shipping taxability information
   */
  async lookupTaxRate(zip: string): Promise<Result<Zip2TaxResponse, Error>> {
    logger.info("Looking up tax rate", { zip });

    // Validate ZIP format
    const zipValidation = this.validateZipCode(zip);
    if (zipValidation.isErr()) {
      return err(zipValidation.error);
    }

    // Try with retry logic
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const result = await this.makeApiCall(zip);

      if (result.isOk()) {
        return result;
      }

      // Don't retry on auth errors or validation errors
      if (
        result.error instanceof Zip2TaxAuthError ||
        result.error instanceof Zip2TaxAPIError
      ) {
        return result;
      }

      // Retry on timeout or network errors
      if (attempt < MAX_RETRIES) {
        logger.warn("Retrying API call", {
          attempt: attempt + 1,
          maxRetries: MAX_RETRIES,
          error: result.error.message
        });
        await this.delay(1000 * (attempt + 1)); // Exponential backoff
      }
    }

    return err(new Zip2TaxAPIError("Failed to lookup tax rate after retries"));
  }

  private async makeApiCall(zip: string): Promise<Result<Zip2TaxResponse, Error>> {
    try {
      const url = this.buildApiUrl(zip);

      // Create AbortController for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const response = await fetch(url, {
          method: "GET",
          signal: controller.signal,
          headers: {
            "Accept": "application/json",
          },
        });

        clearTimeout(timeoutId);

        // Check for HTTP errors
        if (!response.ok) {
          return this.handleHttpError(response.status, await response.text());
        }

        // Parse response
        const data = await response.json();

        // Extract tax rate from response
        return this.parseTaxRate(data);

      } catch (fetchError) {
        clearTimeout(timeoutId);

        if (fetchError instanceof Error && fetchError.name === "AbortError") {
          logger.error("API request timed out", { zip, timeoutMs: this.timeoutMs });
          return err(
            new Zip2TaxTimeoutError(
              `API request timed out after ${this.timeoutMs}ms`,
              { context: { zip } }
            )
          );
        }

        throw fetchError;
      }

    } catch (error) {
      logger.error("API request failed", {
        error: error instanceof Error ? error.message : String(error),
        zip
      });

      return err(
        new Zip2TaxAPIError(
          `Failed to call Zip2Tax API: ${error instanceof Error ? error.message : String(error)}`,
          { context: { zip } }
        )
      );
    }
  }

  private buildApiUrl(zip: string): string {
    const params = new URLSearchParams({
      username: this.username,
      password: this.password,
      zip: zip,
    });

    return `${ZIP2TAX_API_URL}?${params.toString()}`;
  }

  private validateZipCode(zip: string): Result<void, Error> {
    // Accept 5-digit ZIP or 9-digit ZIP+4 (with hyphen)
    const zipRegex = /^\d{5}(-\d{4})?$/;

    if (!zipRegex.test(zip)) {
      return err(
        new Zip2TaxAPIError(
          `Invalid ZIP code format: ${zip}. Expected format: "12345" or "12345-6789"`,
          { context: { zip } }
        )
      );
    }

    return ok(undefined);
  }

  private handleHttpError(status: number, responseText: string): Result<Zip2TaxResponse, Error> {
    logger.error("HTTP error from Zip2Tax API", { status, responseText });

    switch (status) {
      case 401:
      case 403:
        return err(
          new Zip2TaxAuthError(
            "Authentication failed. Please check your username and password.",
            { context: { status, responseText } }
          )
        );

      case 429:
        return err(
          new Zip2TaxRateLimitError(
            "Rate limit exceeded. Please try again later.",
            { context: { status, responseText } }
          )
        );

      case 404:
        return err(
          new Zip2TaxAPIError(
            "ZIP code not found in Zip2Tax database",
            { context: { status, responseText } }
          )
        );

      default:
        return err(
          new Zip2TaxAPIError(
            `API returned error status ${status}: ${responseText}`,
            { context: { status, responseText } }
          )
        );
    }
  }

  private parseTaxRate(data: any): Result<Zip2TaxResponse, Error> {
    try {
      // Handle different possible response formats
      let taxRate: number | undefined;
      let shippingTaxable = false;
      let zip = "";
      let city = "";
      let county = "";
      let state = "";

      if (typeof data === "object" && data !== null) {
        // Format 1: Nested z2tLookup structure (most common)
        // Always use first address: data.z2tLookup.addressInfo.addresses[0]
        if (data.z2tLookup?.addressInfo?.addresses?.length > 0) {
          const firstAddress = data.z2tLookup.addressInfo.addresses[0];
          const addressData = firstAddress?.address;
          const taxRateString = addressData?.salesTax?.rateInfo?.taxRate;

          if (taxRateString) {
            taxRate = parseFloat(taxRateString);

            // Extract location data
            zip = addressData?.zipCode || "";
            city = addressData?.place || "";
            county = addressData?.county || "";
            state = addressData?.state || "";

            // Check notes for shipping taxability
            const notes = addressData?.notes || [];
            shippingTaxable = notes.some((n: any) =>
              n.noteDetail?.note?.toLowerCase().includes("shipping charges are taxable")
            );
          }
        }

        // Format 2: Direct fields (fallback)
        if (!taxRate) {
          taxRate = data.taxRate ?? data.tax_rate ?? data.TaxRate ?? data.rate;
        }

        // Format 3: Results array (fallback)
        if (!taxRate && Array.isArray(data.results) && data.results.length > 0) {
          const firstResult = data.results[0];
          taxRate = firstResult.taxRate ?? firstResult.tax_rate ?? firstResult.TaxRate ?? firstResult.rate;
        }

        // Convert string to number if needed
        if (typeof taxRate === "string") {
          taxRate = parseFloat(taxRate);
        }
      }

      if (typeof taxRate === "number" && !isNaN(taxRate)) {
        const response: Zip2TaxResponse = {
          zip,
          taxRate,
          shippingTaxable,
          city: city || undefined,
          county: county || undefined,
          state: state || undefined,
        };

        logger.info("Tax rate parsed successfully", response);
        return ok(response);
      }

      logger.error("Failed to parse tax rate from response", {
        data,
        attemptedPaths: [
          "z2tLookup.addressInfo.addresses[0].address.salesTax.rateInfo.taxRate",
          "taxRate / tax_rate / TaxRate / rate",
          "results[0].taxRate"
        ]
      });
      return err(
        new Zip2TaxAPIError(
          "Unable to parse tax rate from API response",
          { context: { data } }
        )
      );

    } catch (error) {
      logger.error("Error parsing tax rate", { error, data });
      return err(
        new Zip2TaxAPIError(
          `Error parsing tax rate: ${error instanceof Error ? error.message : String(error)}`,
          { context: { data } }
        )
      );
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
