import { Client } from "urql";

/**
 * Cross-gateway "is this already paid" guard (double-payment prevention —
 * ported from wsm-app-platform's saleor_app_framework/checkout_balance.py).
 * Mirrors the Authorize.net app's equivalent (src/lib/checkout-balance.ts).
 *
 * Saleor's own `totalBalance` = total_charged - checkout_total, so the
 * amount still owed is the negation of that. Reading it via GraphQL means
 * this sees charges recorded by ANY app on this checkout, not just PayPal.
 *
 * Known gap (documented, not fixed here — see
 * wsm-app-platform/docs/double-payment-gap.md): if a prior charge
 * succeeded at the gateway but hasn't yet been recorded as a Saleor
 * transaction (ambiguous state still being confirmed by reconciliation),
 * totalBalance still reads as fully unpaid — this check can't see money
 * Saleor doesn't know about yet.
 */

const OVERCHARGE_TOLERANCE = 0.02;

export type BalanceCheckResult =
  | { ok: true; remainingBalance: number }
  | { ok: false; error: string };

async function fetchTotalBalance(
  graphQLClient: Client,
  sourceId: string,
  isOrder: boolean,
): Promise<BalanceCheckResult> {
  const query = isOrder
    ? `query GetOrderBalance($id: ID!) { order(id: $id) { totalBalance { amount } } }`
    : `query GetCheckoutBalance($id: ID!) { checkout(id: $id) { totalBalance { amount } } }`;

  const { data, error } = await graphQLClient.query(query, { id: sourceId }).toPromise();

  if (error) {
    return { ok: false, error: `Balance check GraphQL error: ${error.message}` };
  }

  const totalBalance = isOrder ? data?.order?.totalBalance : data?.checkout?.totalBalance;
  if (totalBalance?.amount === undefined || totalBalance?.amount === null) {
    return { ok: false, error: "Balance check: totalBalance missing from response" };
  }

  return { ok: true, remainingBalance: -Number(totalBalance.amount) };
}

/**
 * Refuses (fail-closed, including on any query error) if `amount` would
 * overcharge the checkout/order beyond what's actually still owed.
 */
export async function assertNotAlreadyPaid(
  graphQLClient: Client,
  sourceId: string,
  isOrder: boolean,
  amount: number,
): Promise<{ allowed: true } | { allowed: false; message: string }> {
  const result = await fetchTotalBalance(graphQLClient, sourceId, isOrder);

  if (!result.ok) {
    return { allowed: false, message: result.error };
  }

  if (amount > result.remainingBalance + OVERCHARGE_TOLERANCE) {
    return {
      allowed: false,
      message: "This order has already been paid, in full or in part, via another method.",
    };
  }

  return { allowed: true };
}
