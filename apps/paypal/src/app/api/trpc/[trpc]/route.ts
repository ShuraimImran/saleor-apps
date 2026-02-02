import { withSpanAttributesAppRouter } from "@saleor/apps-otel/src/with-span-attributes";
import { compose } from "@saleor/apps-shared/compose";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";

import { createLogger } from "@/lib/logger";
import { withLoggerContext } from "@/lib/logger-context";
import { createTrpcContextAppRouter } from "@/modules/trpc/context-app-router";
import { trpcRouter } from "@/modules/trpc/trpc-router";

const logger = createLogger("trpcHandler");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, saleor-api-url, authorization-bearer",
};

const handler = async (request: Request) => {
  const response = await fetchRequestHandler({
    endpoint: "/api/trpc",
    req: request,
    router: trpcRouter,
    createContext: createTrpcContextAppRouter,
    onError: ({ path, error }) => {
      if (error.code === "INTERNAL_SERVER_ERROR") {
        logger.error(`${path} returned error:`, error);

        return;
      }
      logger.debug(`${path} returned error:`, error);
    },
  });

  Object.entries(corsHeaders).forEach(([key, value]) => {
    response.headers.set(key, value);
  });

  return response;
};

const wrappedHandler = compose(withLoggerContext, withSpanAttributesAppRouter)(handler);

export function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export { wrappedHandler as GET, wrappedHandler as POST };
