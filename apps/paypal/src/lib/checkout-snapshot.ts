export interface CheckoutSnapshot {
  total_net_amount: string;
  lines: Array<{ id: string; quantity: number }>;
}

export async function fetchCheckoutSnapshot(
  client: any,
  checkoutId: string,
): Promise<CheckoutSnapshot | null> {
  const result = await client
    .query(
      `query CheckoutForSnapshot($id: ID!) {
        checkout(id: $id) {
          totalNetAmount { amount }
          lines { id quantity }
        }
      }`,
      { id: checkoutId },
    )
    .toPromise();

  if (result.error || !result.data?.checkout) {
    return null;
  }

  const { checkout } = result.data;
  return {
    total_net_amount: String(checkout.totalNetAmount?.amount ?? "0"),
    lines: checkout.lines.map((l: any) => ({ id: l.id, quantity: l.quantity })),
  };
}

/**
 * Only blocks on line-item changes (different products/quantities than what
 * was actually paid for) — that's the case where letting the order through
 * could ship goods that don't match the charge. A total-only change (shipping
 * method, discount code, tax) is intentionally NOT blocked here: blocking
 * would leave the customer's money sitting in a `needs_review` DB row with
 * no visibility in the merchant's Saleor admin. Letting the order complete
 * instead means Saleor's own "Outstanding balance" on the order surfaces the
 * mismatch directly in the panel the merchant already checks (confirmed live
 * 2026-07-31, order #105: paid $86.19, shipping method changed to drop the
 * checkout to $60.42, order completed and showed "Outstanding balance +25.77"
 * — visible and actionable, unlike a DB flag nobody sees).
 */
export function diffCheckoutSnapshot(
  paid_for: CheckoutSnapshot,
  current: CheckoutSnapshot,
): { content_changed: boolean; message: string } | null {
  const paidLineIds = new Set(paid_for.lines.map((l) => l.id));
  const currentLineIds = new Set(current.lines.map((l) => l.id));

  if (paidLineIds.size !== currentLineIds.size || ![...paidLineIds].every((id) => currentLineIds.has(id))) {
    return {
      content_changed: true,
      message: "Checkout line items changed after payment",
    };
  }

  for (const line of paid_for.lines) {
    const currentLine = current.lines.find((l) => l.id === line.id);
    if (!currentLine || currentLine.quantity !== line.quantity) {
      return {
        content_changed: true,
        message: "Checkout line quantities changed after payment",
      };
    }
  }

  return null;
}
