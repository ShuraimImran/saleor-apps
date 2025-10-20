import { SaleorSyncWebhook } from "@saleor/app-sdk/handlers/next-app-router";

import { CalculateTaxesDocument } from "../../../../generated/graphql";
import { saleorApp } from "../../../../saleor-app";

export const orderCalculateTaxesWebhookDefinition = new SaleorSyncWebhook({
  name: "OrderCalculateTaxes", 
  webhookPath: "/api/webhooks/order-calculate-taxes",
  event: "ORDER_CALCULATE_TAXES",
  apl: saleorApp.apl,
  query: CalculateTaxesDocument,
});