import { router } from "@/modules/trpc/trpc-server";

import { ListSavedPaymentMethodsHandler } from "./list-saved-payment-methods-handler";
import { DeleteSavedPaymentMethodHandler } from "./delete-saved-payment-method-handler";
import { CreateSetupTokenHandler } from "./create-setup-token-handler";
import { CreatePaymentTokenHandler } from "./create-payment-token-handler";

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

  /**
   * Create a setup token for vault-without-purchase flow
   * Used when buyer wants to save a card without making a purchase
   * (e.g., "My Account" > "Payment Methods" > "Add Card")
   *
   * Flow:
   * 1. Frontend calls createSetupToken
   * 2. Render PayPal Card Fields with the setup token
   * 3. Buyer enters card details
   * 4. Call createPaymentTokenFromSetupToken to complete vaulting
   */
  createSetupToken: new CreateSetupTokenHandler().getTrpcProcedure(),

  /**
   * Create a payment token from an approved setup token
   * Completes the vault-without-purchase flow
   *
   * Must be called after setup token is approved (buyer entered card details)
   */
  createPaymentTokenFromSetupToken: new CreatePaymentTokenHandler().getTrpcProcedure(),
});
