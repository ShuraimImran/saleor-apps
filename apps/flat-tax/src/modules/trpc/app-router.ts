import { router } from "@/modules/trpc/trpc-server";

import { appConfigRouter } from "../app-config/app-config.router";
import { taxRatesRouter } from "../tax-rates/tax-rates.router";

export const appRouter = router({
  taxRates: taxRatesRouter,
  appConfig: appConfigRouter,
});

export type AppRouter = typeof appRouter;