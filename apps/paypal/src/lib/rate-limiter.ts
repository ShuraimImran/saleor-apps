import { NextRequest, NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";

const logger = createLogger("RateLimiter");

/**
 * Simple in-memory rate limiter for API endpoints
 *
 * Note: This is a basic implementation suitable for single-instance deployments.
 * For production at scale, consider using Redis-based solutions like @upstash/ratelimit.
 *
 * Features:
 * - Per-IP rate limiting
 * - Configurable window and max requests
 * - Automatic cleanup of expired entries
 */

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

// In-memory store for rate limit tracking
const rateLimitStore = new Map<string, RateLimitEntry>();

// Cleanup interval (every 5 minutes)
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

// Start cleanup timer
let cleanupTimer: NodeJS.Timeout | null = null;

const startCleanupTimer = () => {
  if (cleanupTimer) return;

  cleanupTimer = setInterval(() => {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, entry] of rateLimitStore.entries()) {
      if (now > entry.resetTime) {
        rateLimitStore.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.debug("Rate limiter cleanup completed", { entriesRemoved: cleaned });
    }
  }, CLEANUP_INTERVAL_MS);
};

export interface RateLimitConfig {
  /** Maximum number of requests allowed in the window */
  maxRequests: number;
  /** Time window in milliseconds */
  windowMs: number;
  /** Key prefix for identifying different rate limit buckets */
  keyPrefix?: string;
}

/**
 * Default rate limit configurations for different endpoint types
 */
export const RateLimitConfigs = {
  /** PayPal webhooks - higher limit since PayPal controls the rate */
  webhook: {
    maxRequests: 100,
    windowMs: 60 * 1000, // 100 requests per minute
    keyPrefix: "webhook",
  },
  /** Admin API endpoints - stricter limits */
  admin: {
    maxRequests: 20,
    windowMs: 60 * 1000, // 20 requests per minute
    keyPrefix: "admin",
  },
  /** tRPC API endpoints */
  api: {
    maxRequests: 60,
    windowMs: 60 * 1000, // 60 requests per minute
    keyPrefix: "api",
  },
  /** Authentication/token endpoints - strictest */
  auth: {
    maxRequests: 10,
    windowMs: 60 * 1000, // 10 requests per minute
    keyPrefix: "auth",
  },
} as const;

/**
 * Get client identifier from request
 * Uses IP address with fallback mechanisms
 */
const getClientId = (request: NextRequest): string => {
  // Check for forwarded IP (common in proxied environments)
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    // Take the first IP in the chain (original client)
    return forwardedFor.split(",")[0].trim();
  }

  // Check for real IP header (Cloudflare, nginx)
  const realIp = request.headers.get("x-real-ip");
  if (realIp) {
    return realIp;
  }

  // Fallback to a generic identifier
  return "unknown";
};

/**
 * Check if a request should be rate limited
 *
 * @param request - The incoming request
 * @param config - Rate limit configuration
 * @returns Object with allowed status and headers
 */
export const checkRateLimit = (
  request: NextRequest,
  config: RateLimitConfig
): {
  allowed: boolean;
  remaining: number;
  resetTime: number;
  headers: Record<string, string>;
} => {
  startCleanupTimer();

  const clientId = getClientId(request);
  const key = `${config.keyPrefix || "default"}:${clientId}`;
  const now = Date.now();

  let entry = rateLimitStore.get(key);

  // Create new entry or reset if window expired
  if (!entry || now > entry.resetTime) {
    entry = {
      count: 0,
      resetTime: now + config.windowMs,
    };
  }

  // Increment count
  entry.count++;
  rateLimitStore.set(key, entry);

  const remaining = Math.max(0, config.maxRequests - entry.count);
  const allowed = entry.count <= config.maxRequests;

  // Standard rate limit headers
  const headers: Record<string, string> = {
    "X-RateLimit-Limit": config.maxRequests.toString(),
    "X-RateLimit-Remaining": remaining.toString(),
    "X-RateLimit-Reset": Math.ceil(entry.resetTime / 1000).toString(),
  };

  if (!allowed) {
    headers["Retry-After"] = Math.ceil((entry.resetTime - now) / 1000).toString();

    logger.warn("Rate limit exceeded", {
      clientId,
      keyPrefix: config.keyPrefix,
      count: entry.count,
      maxRequests: config.maxRequests,
    });
  }

  return { allowed, remaining, resetTime: entry.resetTime, headers };
};

/**
 * Rate limiting middleware for Next.js API routes
 *
 * Usage:
 * ```typescript
 * export async function POST(request: NextRequest) {
 *   const rateLimitResult = withRateLimit(request, RateLimitConfigs.webhook);
 *   if (rateLimitResult) return rateLimitResult;
 *
 *   // ... handle request
 * }
 * ```
 */
export const withRateLimit = (
  request: NextRequest,
  config: RateLimitConfig
): NextResponse | null => {
  const result = checkRateLimit(request, config);

  if (!result.allowed) {
    return NextResponse.json(
      {
        error: "Too many requests",
        message: "Rate limit exceeded. Please try again later.",
        retryAfter: Math.ceil((result.resetTime - Date.now()) / 1000),
      },
      {
        status: 429,
        headers: result.headers,
      }
    );
  }

  return null;
};

/**
 * Create a rate-limited route handler wrapper
 *
 * Usage:
 * ```typescript
 * export const POST = createRateLimitedHandler(
 *   RateLimitConfigs.webhook,
 *   async (request) => {
 *     // Your handler logic
 *     return NextResponse.json({ success: true });
 *   }
 * );
 * ```
 */
export const createRateLimitedHandler = (
  config: RateLimitConfig,
  handler: (request: NextRequest) => Promise<NextResponse>
) => {
  return async (request: NextRequest): Promise<NextResponse> => {
    const rateLimitResponse = withRateLimit(request, config);
    if (rateLimitResponse) {
      return rateLimitResponse;
    }

    const response = await handler(request);

    // Add rate limit headers to successful responses
    const result = checkRateLimit(request, config);
    Object.entries(result.headers).forEach(([key, value]) => {
      response.headers.set(key, value);
    });

    return response;
  };
};
