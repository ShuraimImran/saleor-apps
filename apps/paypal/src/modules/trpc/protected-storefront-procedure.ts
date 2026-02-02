import { ObservabilityAttributes } from "@saleor/apps-otel/src/observability-attributes";
import { setTag } from "@sentry/nextjs";
import { TRPCError } from "@trpc/server";
import { gql } from "urql";

import { createGraphQLClient } from "@/lib/graphql-client";
import { createLogger } from "@/lib/logger";
import { saleorApp } from "@/lib/saleor-app";

import { middleware, procedure } from "./trpc-server";

const logger = createLogger("protectedStorefrontProcedure");

const ME_QUERY = gql`
  query Me {
    me {
      id
      email
    }
  }
`;

/**
 * Middleware: Look up the APL to get app credentials for this Saleor tenant.
 * Same as the one in protectedClientProcedure.
 */
const attachAppToken = middleware(async ({ ctx, next }) => {
  if (!ctx.saleorApiUrl) {
    logger.debug("ctx.saleorApiUrl not found, throwing");

    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Missing saleorApiUrl in request",
    });
  }

  const authData = await saleorApp.apl.get(ctx.saleorApiUrl);

  if (!authData) {
    logger.debug("authData not found, throwing 401");

    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Missing auth data",
    });
  }

  return next({
    ctx: {
      appToken: authData.token,
      saleorApiUrl: authData.saleorApiUrl,
      appId: authData.appId,
    },
  });
});

/**
 * Middleware: Validate a storefront user token by calling Saleor's `me` query.
 *
 * Unlike `validateClientToken` (which uses verifyJWT for App Bridge tokens),
 * this middleware works with regular Saleor user tokens from storefront login.
 * It verifies the token by making a `me` query against the Saleor instance.
 * If Saleor returns a valid user, the token is authentic.
 *
 * The verified user ID is added to `ctx.saleorUserId` so handlers don't need
 * to accept it from the request body (preventing user impersonation).
 */
const validateStorefrontToken = middleware(async ({ ctx, next }) => {
  if (!ctx.token) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Missing authorization token",
    });
  }

  if (!ctx.saleorApiUrl) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Missing saleorApiUrl in request",
    });
  }

  setTag(ObservabilityAttributes.SALEOR_API_URL, ctx.saleorApiUrl);

  try {
    logger.debug("Verifying storefront user token via Saleor me query", {
      saleorApiUrl: ctx.saleorApiUrl,
    });

    const client = createGraphQLClient(ctx.saleorApiUrl, ctx.token);
    const result = await client.query(ME_QUERY, {}).toPromise();

    if (result.error || !result.data?.me) {
      logger.debug("Saleor me query failed or returned no user", {
        error: result.error?.message,
        hasData: !!result.data,
      });

      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Invalid or expired user token",
      });
    }

    const saleorUserId = result.data.me.id as string;

    logger.debug("Storefront user verified", {
      saleorUserId,
    });

    return next({
      ctx: {
        ...ctx,
        saleorUserId,
      },
    });
  } catch (error) {
    if (error instanceof TRPCError) {
      throw error;
    }

    logger.debug("Storefront token verification failed", {
      error: error instanceof Error ? error.message : String(error),
    });

    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Token verification failed",
    });
  }
});

const attachSharedServices = middleware(async ({ ctx, next }) => {
  const gqlClient = createGraphQLClient(
    ctx.saleorApiUrl!,
    ctx.token || "",
  );

  return next({
    ctx: {
      ...ctx,
      apiClient: gqlClient,
    },
  });
});

const logErrors = middleware(async ({ next }) => {
  const result = await next();

  if (!result.ok) {
    logger.error(result.error.message, { error: result.error });
  }

  return result;
});

/**
 * Procedure for storefront-facing tRPC endpoints (e.g., vault-without-purchase).
 *
 * Auth flow:
 * 1. attachAppToken - validates saleorApiUrl against APL, gets app credentials
 * 2. validateStorefrontToken - calls Saleor `me` query with the user's JWT
 *    to verify identity, puts verified `saleorUserId` into context
 * 3. attachSharedServices - creates GraphQL client for further queries
 *
 * Context provides:
 * - ctx.saleorUserId: The verified Saleor user ID (from `me` query, not from request body)
 * - ctx.appToken: The app's own token for this Saleor tenant
 * - ctx.appId: The app's ID
 * - ctx.saleorApiUrl: The Saleor instance URL
 * - ctx.apiClient: GraphQL client
 */
export const protectedStorefrontProcedure = procedure
  .use(logErrors)
  .use(attachAppToken)
  .use(validateStorefrontToken)
  .use(attachSharedServices);
