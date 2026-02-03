import { appConfigRouter } from "@/modules/app-config/trpc-handlers/app-config-router";
import { customerVaultRouter } from "@/modules/customer-vault/trpc-handlers/customer-vault-router";
import { merchantOnboardingRouter } from "@/modules/merchant-onboarding/trpc-handlers/merchant-onboarding-router";
import { wsmAdminRouter } from "@/modules/wsm-admin/trpc-handlers/wsm-admin-router";

import { router } from "./trpc-server";

export const trpcRouter = router({
  appConfig: appConfigRouter,
  merchantOnboarding: merchantOnboardingRouter,
  wsmAdmin: wsmAdminRouter,
  // ACDC Card Vaulting (Phase 1)
  customerVault: customerVaultRouter,
});

export type TrpcRouter = typeof trpcRouter;
