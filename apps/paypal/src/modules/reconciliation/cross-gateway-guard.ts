import { getPool } from "@/lib/database";

import { ensureSchema as ensurePaypalReconciliationSchema } from "./reconciliation";

/*
 * This guard reads `authorize_net_reconciliation` too, but that table
 * belongs to the Authorize.Net app. Self-provision it here as well
 * (idempotent, mirrors that app's own schema exactly) so this guard doesn't
 * depend on the Authorize.Net app having started first or its migration
 * having been run — whichever app's webhook fires first creates both tables.
 */
let authorizeNetTableReadyPromise: Promise<void> | null = null;

function ensureAuthorizeNetReconciliationSchema(): Promise<void> {
  if (!authorizeNetTableReadyPromise) {
    authorizeNetTableReadyPromise = getPool()
      .query(
        `CREATE TABLE IF NOT EXISTS authorize_net_reconciliation (
           id BIGSERIAL PRIMARY KEY,
           tenant TEXT NOT NULL,
           checkout_id TEXT NOT NULL,
           transaction_id TEXT NOT NULL,
           idempotency_key TEXT,
           invoice_number TEXT,
           known_trans_id TEXT,
           amount NUMERIC NOT NULL,
           status TEXT NOT NULL DEFAULT 'pending',
           attempts INT NOT NULL DEFAULT 0,
           created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
           last_checked_at TIMESTAMPTZ,
           resolved_at TIMESTAMPTZ,
           note TEXT
         );
         CREATE INDEX IF NOT EXISTS authorize_net_reconciliation_pending
           ON authorize_net_reconciliation (status, last_checked_at);`,
      )
      .then(() => undefined)
      .catch((error) => {
        authorizeNetTableReadyPromise = null;
        throw error;
      });
  }

  return authorizeNetTableReadyPromise;
}

export type UnresolvedPaymentAttemptCheck =
  | { blocked: false }
  /*
   * A real pending/needs_review row was found — safe to tell the customer
   * exactly what's happening.
   */
  | { blocked: true; reason: "pending_reconciliation" }
  /*
   * The lookup itself failed (DB error, missing table, etc.) — fail closed,
   * but this is an infra problem, not a real prior attempt, so callers
   * should show a generic message instead of implying one exists.
   */
  | { blocked: true; reason: "query_error" };

async function checkTable(
  tableLabel: string,
  query: string,
  checkoutId: string,
): Promise<{ found: boolean; errored: boolean }> {
  try {
    const result = await getPool().query(query, [checkoutId]);

    return { found: (result.rowCount ?? 0) > 0, errored: false };
  } catch (error) {
    console.error(`cross-gateway-guard: ${tableLabel} lookup failed:`, error);

    return { found: false, errored: true };
  }
}

/**
 * Closes the gap the lock + balance check (payment-attempt-lock.ts,
 * checkout-balance.ts) can't: a retry that lands *while* a prior ambiguous
 * charge on this checkout is still being confirmed by reconciliation.
 * Mirrors the Authorize.net app's equivalent
 * (src/lib/cross-gateway-guard.ts).
 *
 * Saleor's totalBalance only reflects charges it already knows about — a
 * charge sitting in `pending`/`needs_review` in either gateway's
 * reconciliation table is real money the customer may have already paid,
 * but Saleor hasn't heard about it yet, so the balance check alone would
 * wave a second attempt through. Confirmed in testing: without this, a
 * customer retrying within the reconciliation window can get charged
 * multiple times for the same order (see
 * wsm-app-platform/docs/double-payment-gap.md, "Gap 1").
 *
 * Checks BOTH gateways' reconciliation tables — they share the same
 * Postgres instance — so a pending Authorize.Net charge blocks a PayPal
 * retry on the same checkout and vice versa.
 */
export async function hasUnresolvedPaymentAttempt(
  checkoutId: string,
): Promise<UnresolvedPaymentAttemptCheck> {
  /*
   * Best-effort — if this itself fails (DB genuinely down, not just a
   * missing table), the queries below fail too and hit the existing
   * fail-closed catches, so nothing is lost by not re-throwing here.
   */
  await Promise.all([
    ensureAuthorizeNetReconciliationSchema().catch((error) => {
      console.error("cross-gateway-guard: could not ensure authorize_net_reconciliation schema:", error);
    }),
    ensurePaypalReconciliationSchema().catch((error) => {
      console.error("cross-gateway-guard: could not ensure paypal_reconciliation schema:", error);
    }),
  ]);

  const [authorizeNetResult, paypalResult] = await Promise.all([
    checkTable(
      "authorize_net_reconciliation",
      `SELECT 1 FROM authorize_net_reconciliation
       WHERE checkout_id = $1 AND status IN ('pending', 'needs_review') LIMIT 1`,
      checkoutId,
    ),
    checkTable(
      "paypal_reconciliation",
      `SELECT 1 FROM paypal_reconciliation
       WHERE checkout_id = $1 AND status IN ('pending', 'needs_review') LIMIT 1`,
      checkoutId,
    ),
  ]);

  if (authorizeNetResult.found || paypalResult.found) {
    return { blocked: true, reason: "pending_reconciliation" };
  }
  if (authorizeNetResult.errored || paypalResult.errored) {
    return { blocked: true, reason: "query_error" };
  }

  return { blocked: false };
}

/**
 * Customer-facing text for a blocked attempt — honest when it's a real
 * pending charge, generic when it's really just an infra hiccup fail-closed.
 * Mirrors the Authorize.net app's equivalent (src/lib/cross-gateway-guard.ts). 
 */
export function messageForAttemptCheck(check: Extract<UnresolvedPaymentAttemptCheck, { blocked: true }>): string {
  return check.reason === "pending_reconciliation"
    ? "A previous payment attempt for this order is still being confirmed. Please wait a few minutes before trying again."
    : "An internal error occurred while processing your payment. Please try again in a few minutes.";
}
