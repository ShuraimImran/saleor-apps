import { fetchRequestHandler } from "@trpc/server/adapters/fetch";

import { appRouter } from "@/modules/trpc/app-router";
import { createTrpcContextAppRouter } from "@/modules/trpc/context-app-router";

const handler = (request: Request) => {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: request,
    router: appRouter,
    createContext: createTrpcContextAppRouter,
  });
};

export { handler as GET, handler as POST };