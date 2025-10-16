export class FlatTaxError extends Error {
  public operation?: string;
  public context?: Record<string, unknown>;

  constructor(message: string, options?: { operation?: string; context?: Record<string, unknown> }) {
    super(message);
    this.name = this.constructor.name;
    this.operation = options?.operation;
    this.context = options?.context;
  }
}

export class TaxRateRepositoryError extends FlatTaxError {}
export class TaxRateNotFoundError extends TaxRateRepositoryError {}
export class TaxRateValidationError extends TaxRateRepositoryError {}
export class TaxRateMetadataError extends TaxRateRepositoryError {}

export class AppConfigRepositoryError extends FlatTaxError {}
export class AppConfigValidationError extends AppConfigRepositoryError {}
export class AppConfigMetadataError extends AppConfigRepositoryError {}

export class TaxCalculationError extends FlatTaxError {}
export class NoMatchingTaxRatesError extends TaxCalculationError {}
export class InvalidAddressError extends TaxCalculationError {}
export class UnsupportedCountryError extends TaxCalculationError {}

export class WebhookError extends FlatTaxError {}
export class InvalidWebhookPayloadError extends WebhookError {}
export class WebhookAuthenticationError extends WebhookError {}