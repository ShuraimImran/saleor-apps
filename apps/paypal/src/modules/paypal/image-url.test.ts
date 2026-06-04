import { describe, expect, it } from "vitest";

import { isValidPayPalImageUrl, pickPayPalImageUrl } from "./image-url";

/*
 * Regression target: PayPal rejects the entire create-order request with
 * INVALID_REQUEST when items[].image_url doesn't match its URL pattern.
 * Real production case: Saleor's /thumbnail/<base64>/<size>/ proxy URL
 * (no file extension, trailing slash) reached PayPal and broke checkout.
 */

const SUE_FAILING_URL =
  "https://api-big-dog-aftermarket.wsm-dev.com/thumbnail/UHJvZHVjdE1lZGlhOjEzNTI4OTkxNg==/256/";
const SUE_FALLBACK_URL =
  "https://wsm-saleor-assets.s3.us-west-2.amazonaws.com/thumbnails/big-dog-aftermarket/135289916_M145939460_thumbnail_4096.png";

describe("isValidPayPalImageUrl", () => {
  it("accepts a plain https URL ending with .png", () => {
    expect(isValidPayPalImageUrl("https://example.com/foo.png")).toBe(true);
  });

  it("accepts each documented image extension", () => {
    const exts = ["png", "jpg", "jpeg", "gif", "webp", "bmp"];

    for (const ext of exts) {
      expect(isValidPayPalImageUrl(`https://example.com/foo.${ext}`)).toBe(true);
    }
  });

  it("is case-insensitive on the extension", () => {
    expect(isValidPayPalImageUrl("https://example.com/foo.PNG")).toBe(true);
    expect(isValidPayPalImageUrl("https://example.com/foo.JpG")).toBe(true);
  });

  it("accepts multi-segment paths", () => {
    expect(
      isValidPayPalImageUrl("https://example.com/a/b/c/d/file.webp"),
    ).toBe(true);
  });

  it("accepts an optional ?query string after the extension", () => {
    expect(isValidPayPalImageUrl("https://example.com/foo.png?w=256")).toBe(true);
    expect(
      isValidPayPalImageUrl("https://cdn.example.com/x.jpg?signature=abc&v=1"),
    ).toBe(true);
  });

  /*
   * The exact failure mode in production. If this ever passes again, the
   * regression has returned and PayPal will reject the order silently from
   * the customer's perspective.
   */
  it("rejects Saleor's dynamic thumbnail proxy URL with no extension and trailing slash", () => {
    expect(isValidPayPalImageUrl(SUE_FAILING_URL)).toBe(false);
  });

  it("rejects http (non-https) URLs", () => {
    expect(isValidPayPalImageUrl("http://example.com/foo.png")).toBe(false);
  });

  it("rejects URLs with no file extension", () => {
    expect(isValidPayPalImageUrl("https://example.com/foo")).toBe(false);
    expect(isValidPayPalImageUrl("https://example.com/")).toBe(false);
    expect(isValidPayPalImageUrl("https://example.com/path/")).toBe(false);
  });

  it("rejects extensions not in the allowed list", () => {
    expect(isValidPayPalImageUrl("https://example.com/foo.svg")).toBe(false);
    expect(isValidPayPalImageUrl("https://example.com/foo.tiff")).toBe(false);
    expect(isValidPayPalImageUrl("https://example.com/foo.html")).toBe(false);
  });

  it("rejects hosts with no dot (e.g. localhost)", () => {
    expect(isValidPayPalImageUrl("https://localhost/foo.png")).toBe(false);
  });

  it("rejects #fragment after the extension", () => {
    /*
     * PayPal docs only mention ?query in their pattern. Be conservative and
     * reject fragments — if PayPal silently strips them, the worst we do is
     * skip a thumbnail we could have sent.
     */
    expect(isValidPayPalImageUrl("https://example.com/foo.png#section")).toBe(
      false,
    );
  });

  it("rejects whitespace anywhere in the URL", () => {
    expect(isValidPayPalImageUrl("https://example.com/foo .png")).toBe(false);
    expect(isValidPayPalImageUrl("https://exa mple.com/foo.png")).toBe(false);
    expect(isValidPayPalImageUrl(" https://example.com/foo.png")).toBe(false);
    expect(isValidPayPalImageUrl("https://example.com/foo.png ")).toBe(false);
  });

  it("rejects an extension that appears only inside the query string", () => {
    /*
     * "?file=foo.png" means the path itself has no extension. Must reject —
     * otherwise we'd send PayPal a URL that isn't actually an image.
     */
    expect(
      isValidPayPalImageUrl("https://example.com/api?file=foo.png"),
    ).toBe(false);
  });

  it("rejects empty string, null, undefined, and non-string inputs", () => {
    expect(isValidPayPalImageUrl("")).toBe(false);
    expect(isValidPayPalImageUrl(null)).toBe(false);
    expect(isValidPayPalImageUrl(undefined)).toBe(false);
    expect(isValidPayPalImageUrl(123 as unknown)).toBe(false);
    expect(isValidPayPalImageUrl({} as unknown)).toBe(false);
    expect(isValidPayPalImageUrl([] as unknown)).toBe(false);
  });

  it("rejects URLs longer than 2048 characters", () => {
    const veryLong = `https://example.com/${"a".repeat(2030)}.png`;

    expect(veryLong.length).toBeGreaterThan(2048);
    expect(isValidPayPalImageUrl(veryLong)).toBe(false);
  });

  it("accepts a URL at exactly the 2048 character cap", () => {
    const suffix = ".png";
    const prefix = "https://example.com/";
    const pad = "a".repeat(2048 - prefix.length - suffix.length);
    const exactlyCap = `${prefix}${pad}${suffix}`;

    expect(exactlyCap.length).toBe(2048);
    expect(isValidPayPalImageUrl(exactlyCap)).toBe(true);
  });

  it("accepts the known-good S3 fallback URL from Sue's order", () => {
    expect(isValidPayPalImageUrl(SUE_FALLBACK_URL)).toBe(true);
  });
});

describe("pickPayPalImageUrl", () => {
  it("returns the first valid candidate", () => {
    expect(
      pickPayPalImageUrl([
        "https://example.com/a.png",
        "https://example.com/b.png",
      ]),
    ).toBe("https://example.com/a.png");
  });

  it("falls back to a later candidate when the first is invalid", () => {
    expect(pickPayPalImageUrl([SUE_FAILING_URL, SUE_FALLBACK_URL])).toBe(
      SUE_FALLBACK_URL,
    );
  });

  it("skips null and undefined candidates between valid ones", () => {
    expect(
      pickPayPalImageUrl([
        null,
        undefined,
        "https://example.com/late.png",
      ]),
    ).toBe("https://example.com/late.png");
  });

  it("returns undefined when every candidate is invalid", () => {
    expect(
      pickPayPalImageUrl([
        SUE_FAILING_URL,
        "http://example.com/foo.png",
        "https://example.com/foo.svg",
        null,
        undefined,
      ]),
    ).toBeUndefined();
  });

  it("returns undefined for an empty candidate list", () => {
    expect(pickPayPalImageUrl([])).toBeUndefined();
  });

  it("returns undefined when every candidate is null or undefined", () => {
    expect(pickPayPalImageUrl([null, undefined, null])).toBeUndefined();
  });

  /*
   * Order matters: a valid earlier candidate must win even if a later one
   * is also valid. Prevents the helper from silently re-prioritizing.
   */
  it("preserves candidate order, not URL length or any other heuristic", () => {
    const shortValid = "https://example.com/x.png";
    const longValid = `https://example.com/${"x".repeat(50)}.png`;

    expect(pickPayPalImageUrl([shortValid, longValid])).toBe(shortValid);
    expect(pickPayPalImageUrl([longValid, shortValid])).toBe(longValid);
  });
});
