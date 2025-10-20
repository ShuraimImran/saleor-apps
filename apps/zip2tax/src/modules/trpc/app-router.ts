import { router } from "@/modules/trpc/trpc-server";

import { appConfigRouter } from "../app-config/app-config.router";
import { taxLookupsRouter } from "../tax-lookups/tax-lookups.router";

export const appRouter = router({
  taxLookups: taxLookupsRouter,
  appConfig: appConfigRouter,
});

export type AppRouter = typeof appRouter;