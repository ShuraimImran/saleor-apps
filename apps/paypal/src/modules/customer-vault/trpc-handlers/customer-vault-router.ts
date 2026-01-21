import { router } from "@/modules/trpc/trpc-server";

import { ListSavedPaymentMethodsHandler } from "./list-saved-payment-methods-handler";
import { DeleteSavedPaymentMethodHandler } from "./delete-saved-payment-method-handler";

/**
 * Customer Vault Router
 * Handles ACDC Card Vaulting operations (Phase 1)
 */
export const customerVaultRouter = router({
  /**
   * List saved payment methods for a customer
   * Used for "Return Buyer" flow - display saved cards at checkout
   */
  listSavedPaymentMethods: new ListSavedPaymentMethodsHandler().getTrpcProcedure(),

  /**
   * Delete a saved payment method
   * Allows customers to remove saved cards from their account
   */
  deleteSavedPaymentMethod: new DeleteSavedPaymentMethodHandler().getTrpcProcedure(),
});
