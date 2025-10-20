import { SaleorSyncWebhook } from "@saleor/app-sdk/handlers/next-app-router";

import { CalculateTaxesDocument } from "../../../../generated/graphql";  
import { saleorApp } from "../../../../saleor-app";

export const checkoutCalculateTaxesWebhookDefinition = new SaleorSyncWebhook({
  name: "CheckoutCalculateTaxes",
  webhookPath: "/api/webhooks/checkout-calculate-taxes",
  event: "CHECKOUT_CALCULATE_TAXES", 
  apl: saleorApp.apl,
  query: CalculateTaxesDocument,
});