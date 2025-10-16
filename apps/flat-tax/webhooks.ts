import { checkoutCalculateTaxesWebhookDefinition } from "./src/modules/webhooks/definitions/checkout-calculate-taxes";
import { orderCalculateTaxesWebhookDefinition } from "./src/modules/webhooks/definitions/order-calculate-taxes";

export const appWebhooks = [
  checkoutCalculateTaxesWebhookDefinition,
  orderCalculateTaxesWebhookDefinition,
];