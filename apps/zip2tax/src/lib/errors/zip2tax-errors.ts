export class Zip2TaxError extends Error {
  public operation?: string;
  public context?: Record<string, unknown>;

  constructor(message: string, options?: { operation?: string; context?: Record<string, unknown> }) {
    super(message);
    this.name = this.constructor.name;
    this.operation = options?.operation;
    this.context = options?.context;
  }
}

export class TaxLookupRepositoryError extends Zip2TaxError {}
export class TaxLookupNotFoundError extends TaxLookupRepositoryError {}
export class TaxLookupValidationError extends TaxLookupRepositoryError {}
export class TaxLookupMetadataError extends TaxLookupRepositoryError {}

export class AppConfigRepositoryError extends Zip2TaxError {}
export class AppConfigValidationError extends AppConfigRepositoryError {}
export class AppConfigMetadataError extends AppConfigRepositoryError {}

export class TaxCalculationError extends Zip2TaxError {}
export class InvalidAddressError extends TaxCalculationError {}
export class InvalidZipCodeError extends TaxCalculationError {}

export class Zip2TaxAPIError extends Zip2TaxError {}
export class Zip2TaxAuthError extends Zip2TaxAPIError {}
export class Zip2TaxTimeoutError extends Zip2TaxAPIError {}
export class Zip2TaxRateLimitError extends Zip2TaxAPIError {}

export class USPSAPIError extends Zip2TaxError {}
export class USPSAuthError extends USPSAPIError {}
export class USPSTimeoutError extends USPSAPIError {}
export class USPSAddressNotFoundError extends USPSAPIError {}
export class USPSInvalidAddressError extends USPSAPIError {}

export class WebhookError extends Zip2TaxError {}
export class InvalidWebhookPayloadError extends WebhookError {}
export class WebhookAuthenticationError extends WebhookError {}