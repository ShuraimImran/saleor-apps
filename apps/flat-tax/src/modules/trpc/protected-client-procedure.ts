import { TRPCError } from "@trpc/server";
import { saleorApp } from "../../../saleor-app";

import { middleware, procedure } from "./trpc-server";

const attachAuthData = middleware(async ({ ctx, next }) => {
  console.log("🔧 protectedClientProcedure - Fetching auth data from APL");

  const saleorApiUrl = ctx.authData?.saleorApiUrl;

  if (!saleorApiUrl) {
    console.log("❌ protectedClientProcedure - Missing saleorApiUrl");
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Missing saleorApiUrl in request",
    });
  }

  // Get auth data from APL (Auth Persistence Layer)
  const authData = await saleorApp.apl.get(saleorApiUrl);

  if (!authData) {
    console.log("❌ protectedClientProcedure - Auth data not found in APL");
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Missing auth data",
    });
  }

  console.log("✅ protectedClientProcedure - Auth data from APL:", {
    saleorApiUrl: authData.saleorApiUrl,
    appId: authData.appId,
    hasToken: !!authData.token,
  });

  return next({
    ctx: {
      authData,
    },
  });
});

const protectedMiddleware = middleware(async ({ ctx, next }) => {
  if (!ctx.authData) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Not authenticated",
    });
  }

  if (!ctx.authData.token) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Missing authentication token",
    });
  }

  return next({
    ctx: {
      ...ctx,
      authData: ctx.authData,
    },
  });
});

export const protectedClientProcedure = procedure
  .use(attachAuthData)
  .use(protectedMiddleware);
