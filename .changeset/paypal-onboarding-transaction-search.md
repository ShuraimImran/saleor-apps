---
"saleor-app-payment-paypal": patch
---

Request the `ADVANCED_TRANSACTIONS_SEARCH` feature during PayPal partner onboarding.

This grants the partner access to the Transaction Search / Reporting API (`GET /v1/reporting/transactions`) on the merchant's behalf, which powers the reconciliation recovery audit (`pnpm report:untracked-transactions`). Without it that call fails with `403 NOT_AUTHORIZED`. Merchants onboarded before this change must reconnect (re-consent) their PayPal account to grant the new permission.
