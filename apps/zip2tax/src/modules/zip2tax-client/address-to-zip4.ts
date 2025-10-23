import { err, ok, Result } from "neverthrow";
import { createLogger } from "@/logger";
import { InvalidZipCodeError } from "@/lib/errors/zip2tax-errors";

const logger = createLogger("AddressToZip4");

export interface Address {
  country?: string;
  countryArea?: string | null;
  postalCode?: string | null;
  city?: string | null;
  streetAddress1?: string | null;
  streetAddress2?: string | null;
}

/**
 * Extract ZIP or ZIP+4 code from an address
 * @param address - Address object with postal code
 * @returns ZIP or ZIP+4 code (e.g., "90210" or "90210-3303")
 */
export function extractZip4FromAddress(address: Address): Result<string, Error> {
  const postalCode = address.postalCode?.trim();

  if (!postalCode) {
    logger.warn("No postal code provided in address");
    return err(new InvalidZipCodeError("No postal code provided in address"));
  }

  // Remove any spaces from postal code
  const cleanedZip = postalCode.replace(/\s/g, "");

  // Check if it's already in ZIP+4 format (12345-6789)
  const zip4Pattern = /^(\d{5})-(\d{4})$/;
  const zip4Match = cleanedZip.match(zip4Pattern);

  if (zip4Match) {
    return ok(cleanedZip);
  }

  // Check if it's a 9-digit ZIP without hyphen (123456789)
  const zip9Pattern = /^(\d{9})$/;
  const zip9Match = cleanedZip.match(zip9Pattern);

  if (zip9Match) {
    // Format as ZIP+4 with hyphen
    const formatted = `${cleanedZip.slice(0, 5)}-${cleanedZip.slice(5)}`;
    return ok(formatted);
  }

  // Check if it's a standard 5-digit ZIP
  const zip5Pattern = /^(\d{5})$/;
  const zip5Match = cleanedZip.match(zip5Pattern);

  if (zip5Match) {
    // Return as-is, the API can handle 5-digit ZIPs
    return ok(cleanedZip);
  }

  // Invalid format
  logger.warn("Invalid ZIP code format", { postalCode: cleanedZip });
  return err(
    new InvalidZipCodeError(
      `Invalid ZIP code format: "${postalCode}". Expected 5-digit ZIP or ZIP+4.`,
      { context: { postalCode, address } }
    )
  );
}

/**
 * Attempt to build ZIP+4 from address components
 *
 * This function attempts to derive ZIP+4 from the full address. Currently:
 * 1. Tries to extract ZIP+4 from the postalCode field if already present
 * 2. Falls back to 5-digit ZIP if that's all that's available
 *
 * LIMITATION: Deriving the +4 extension from street address components requires
 * an external address validation service (USPS, SmartyStreets, etc.). Without this,
 * we can only use what's provided in the postalCode field.
 *
 * FUTURE ENHANCEMENT: Integrate with address validation service:
 * - USPS Address Validation API (free, requires registration)
 * - SmartyStreets (commercial, accurate)
 * - Melissa Data (commercial)
 *
 * For now, Zip2Tax API accepts both 5-digit and ZIP+4 codes, so this works.
 *
 * @param address - Full address with street, city, state, postal code
 * @returns ZIP+4 if available in postalCode, otherwise 5-digit ZIP
 */
export function buildZip4FromAddress(address: Address): Result<string, Error> {
  // First, try to extract from postal code field (handles 5-digit, ZIP+4, 9-digit)
  const extractResult = extractZip4FromAddress(address);

  if (extractResult.isOk()) {
    return extractResult;
  }

  // TODO: Integrate with address validation service to derive ZIP+4 from components
  // Example implementation:
  // if (addressValidationServiceConfigured) {
  //   const validatedAddress = await addressValidationService.validate({
  //     street: address.streetAddress1,
  //     city: address.city,
  //     state: address.countryArea,
  //     zip: address.postalCode
  //   });
  //   return ok(validatedAddress.zip4);
  // }

  logger.info(
    "Cannot derive ZIP+4 without address validation service. Using available postal code.",
    {
      postalCode: address.postalCode,
      city: address.city,
      state: address.countryArea,
      street: address.streetAddress1,
    }
  );

  // Return the error from extraction attempt - caller should handle gracefully
  return extractResult;
}

/**
 * Validate that a ZIP code is in a supported format
 * @param zip - ZIP code to validate
 * @returns true if valid, false otherwise
 */
export function isValidZipFormat(zip: string): boolean {
  if (!zip) {
    return false;
  }

  const cleanedZip = zip.trim().replace(/\s/g, "");

  // Accept: 12345 or 12345-6789 or 123456789
  return /^(\d{5}(-\d{4})?|\d{9})$/.test(cleanedZip);
}

/**
 * Normalize ZIP code to standard format
 * Converts 123456789 → 12345-6789
 * Leaves 12345 and 12345-6789 as-is
 */
export function normalizeZipCode(zip: string): string {
  const cleanedZip = zip.trim().replace(/\s/g, "");

  // If it's 9 digits without hyphen, add hyphen
  if (/^\d{9}$/.test(cleanedZip)) {
    return `${cleanedZip.slice(0, 5)}-${cleanedZip.slice(5)}`;
  }

  return cleanedZip;
}

