import { getPool } from "@/lib/database";

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
export async function hasUnresolvedPaymentAttempt(checkoutId: string): Promise<boolean> {
  const pool = getPool();

  const [authorizeNetResult, paypalResult] = await Promise.all([
    pool
      .query(
        `SELECT 1 FROM authorize_net_reconciliation
         WHERE checkout_id = $1 AND status IN ('pending', 'needs_review') LIMIT 1`,
        [checkoutId],
      )
      .catch((error) => {
        console.error("cross-gateway-guard: authorize_net_reconciliation lookup failed:", error);
        return { rowCount: 1 } as { rowCount: number };
      }),
    pool
      .query(
        `SELECT 1 FROM paypal_reconciliation
         WHERE checkout_id = $1 AND status IN ('pending', 'needs_review') LIMIT 1`,
        [checkoutId],
      )
      .catch((error) => {
        console.error("cross-gateway-guard: paypal_reconciliation lookup failed:", error);
        return { rowCount: 1 } as { rowCount: number };
      }),
  ]);

  return (authorizeNetResult.rowCount ?? 0) > 0 || (paypalResult.rowCount ?? 0) > 0;
}
