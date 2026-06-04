/*
 * PayPal's purchase_units[].items[].image_url field is regex-validated server-side
 * against an https URL ending in a recognized image extension. Sending a URL that
 * doesn't match (e.g. Saleor's dynamic /thumbnail/<id>/<size>/ proxy with no
 * extension) makes PayPal reject the entire create-order request with
 * INVALID_REQUEST. The field is optional — omitting it is safer than sending an
 * invalid one.
 */

const PAYPAL_IMAGE_URL_MAX_LENGTH = 2048;

/*
 * Approximates PayPal's documented pattern, which is roughly:
 *   https : / / host-with-a-dot / path / file . (png|jpg|gif|webp|bmp|jpeg)
 * - https only
 * - host must contain at least one dot (so localhost / bare hosts fail)
 * - the path's final segment must end with one of the allowed extensions
 * - optional ?query allowed; #fragment is not (PayPal docs only mention query)
 */
const PAYPAL_IMAGE_URL_REGEX =
  /^https:\/\/[^/?\s]+\.[^/?\s]+\/[^?\s]*\.(png|jpg|jpeg|gif|webp|bmp)(\?\S*)?$/i;

export const isValidPayPalImageUrl = (url: unknown): url is string => {
  if (typeof url !== "string") return false;
  if (url.length === 0 || url.length > PAYPAL_IMAGE_URL_MAX_LENGTH) return false;

  return PAYPAL_IMAGE_URL_REGEX.test(url);
};

export const pickPayPalImageUrl = (
  candidates: ReadonlyArray<string | null | undefined>,
): string | undefined => {
  for (const candidate of candidates) {
    if (isValidPayPalImageUrl(candidate)) return candidate;
  }

  return undefined;
};
