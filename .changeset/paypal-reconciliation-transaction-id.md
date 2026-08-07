---
"saleor-app-payment-paypal": patch
---

Fix PayPal reconciliation failing with a Postgres `NOT NULL` violation on `paypal_reconciliation.transaction_id`.

Installs whose `TRANSACTION_PROCESS_SESSION` webhook was registered in Saleor **before** `transaction.id` was added to the subscription fragment kept sending payloads without it. `event.transaction.id` arrived `undefined`, so the reconciliation insert died on the constraint (logged only as the cryptic `Reconciliation save failed`), which silently disabled the "PayPal captured but Saleor doesn't know yet" safety net for that tenant.

- `savePendingReconciliation` now detects a missing `transaction.id` up front and logs an actionable remedy instead of failing on the constraint.
- `run-webhooks-migration.ts` now registers the transaction initialize/process session webhooks, so `pnpm migrate` refreshes their stored subscription queries.
- New `pnpm repair:webhook-queries` script updates an existing install's stored subscription queries in place via `webhookUpdate` — non-destructive (never creates/deletes, `--apply`-gated), so it needs no reinstall (which would wipe the tenant's PayPal config held in app private metadata).
