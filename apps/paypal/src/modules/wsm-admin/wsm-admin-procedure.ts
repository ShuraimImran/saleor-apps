import { TRPCError } from "@trpc/server";

import { extractTokenFromCookies, verifyJwtToken } from "./auth";

/**
 * Validate WSM admin JWT token from cookies
 * Used by all WSM admin tRPC handlers
 */
export function validateWsmAdminAuth(cookieHeader: string | null): { email: string; userId: string } {
  const token = extractTokenFromCookies(cookieHeader);

  if (!token) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Not authenticated. Please log in.",
    });
  }

  const payload = verifyJwtToken(token);

  if (!payload) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Session expired. Please log in again.",
    });
  }

  return payload;
}
