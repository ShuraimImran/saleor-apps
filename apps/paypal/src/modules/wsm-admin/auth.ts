import * as crypto from "crypto";

import { createLogger } from "@/lib/logger";

const logger = createLogger("WsmAdminAuth");

const SALT_LENGTH = 16;
const KEY_LENGTH = 64;
const JWT_EXPIRY_SECONDS = 15 * 60; // 15 minutes

/**
 * Hash a password using scrypt
 */
export async function hashPassword(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(SALT_LENGTH).toString("hex");

    crypto.scrypt(password, salt, KEY_LENGTH, (err, derivedKey) => {
      if (err) reject(err);
      resolve(`${salt}:${derivedKey.toString("hex")}`);
    });
  });
}

/**
 * Verify a password against a hash
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const [salt, key] = hash.split(":");

    if (!salt || !key) {
      resolve(false);

      return;
    }

    crypto.scrypt(password, salt, KEY_LENGTH, (err, derivedKey) => {
      if (err) reject(err);
      resolve(crypto.timingSafeEqual(Buffer.from(key, "hex"), derivedKey));
    });
  });
}

/**
 * Get the JWT secret from the app's SECRET_KEY
 */
function getJwtSecret(): string {
  const secret = process.env.SECRET_KEY;

  if (!secret) {
    throw new Error("SECRET_KEY environment variable is required for JWT signing");
  }

  return secret;
}

/**
 * Create a JWT token (using HMAC-SHA256, no external dependencies)
 */
export function createJwtToken(payload: { email: string; userId: string }): string {
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);

  const tokenPayload = {
    ...payload,
    iat: now,
    exp: now + JWT_EXPIRY_SECONDS,
  };

  const encodedHeader = Buffer.from(JSON.stringify(header)).toString("base64url");
  const encodedPayload = Buffer.from(JSON.stringify(tokenPayload)).toString("base64url");

  const signature = crypto
    .createHmac("sha256", getJwtSecret())
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest("base64url");

  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

/**
 * Verify and decode a JWT token
 */
export function verifyJwtToken(token: string): { email: string; userId: string } | null {
  try {
    const parts = token.split(".");

    if (parts.length !== 3) {
      return null;
    }

    const [encodedHeader, encodedPayload, signature] = parts;

    // Verify signature
    const expectedSignature = crypto
      .createHmac("sha256", getJwtSecret())
      .update(`${encodedHeader}.${encodedPayload}`)
      .digest("base64url");

    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
      logger.warn("JWT signature verification failed");

      return null;
    }

    // Decode payload
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString());

    // Check expiry
    const now = Math.floor(Date.now() / 1000);

    if (payload.exp && payload.exp < now) {
      logger.debug("JWT token expired");

      return null;
    }

    return { email: payload.email, userId: payload.userId };
  } catch (error) {
    logger.error("JWT verification error", {
      error: error instanceof Error ? error.message : String(error),
    });

    return null;
  }
}

/**
 * Extract JWT token from cookie header
 */
export function extractTokenFromCookies(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;

  const cookies = cookieHeader.split(";").map((c) => c.trim());
  const tokenCookie = cookies.find((c) => c.startsWith("wsm_admin_token="));

  if (!tokenCookie) return null;

  return tokenCookie.split("=")[1] || null;
}
