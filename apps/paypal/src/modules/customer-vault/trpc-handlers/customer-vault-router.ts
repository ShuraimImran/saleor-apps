import { router } from "@/modules/trpc/trpc-server";

import { ListSavedPaymentMethodsHandler } from "./list-saved-payment-methods-handler";
import { DeleteSavedPaymentMethodHandler } from "./delete-saved-payment-method-handler";
import { CreateSetupTokenHandler } from "./create-setup-token-handler";
import { CreatePaymentTokenHandler } from "./create-payment-token-handler";
import { GenerateClientTokenHandler } from "./generate-client-token-handler";

/**
 * Customer Vault Router
 * Handles ACDC Card Vaulting operations (Phase 1)
 */
export const customerVaultRouter = router({
  /**
   * Generate a PayPal Client Token for JS SDK v6
   * Must be called before initializing the SDK on the frontend
   */
  generateClientToken: new GenerateClientTokenHandler().getTrpcProcedure(),

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
   * 1. Frontend calls generateClientToken (for SDK v6 init)
   * 2. Frontend calls createSetupToken
   * 3. Render PayPal Card Fields with the setup token
   * 4. Buyer enters card details
   * 5. Call createPaymentTokenFromSetupToken to complete vaulting
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
