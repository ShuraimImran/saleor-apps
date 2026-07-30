import { getPool } from "@/lib/database";
import { createGraphQLClient } from "@/lib/graphql-client";
import { createLogger } from "@/lib/logger";
import { paypalConfigRepo } from "@/modules/paypal/configuration/paypal-config-repo";
import { interpretCaptureResponse } from "@/modules/paypal/capture-result";
import { createPayPalOrderId } from "@/modules/paypal/paypal-order-id";
import { PayPalOrdersApiFactory } from "@/modules/paypal/paypal-orders-api-factory";
import { saleorApp } from "@/lib/saleor-app";

const logger = createLogger("PayPalReconciliation");

/**
 * WSM6-1373 safety net: a durable record of "PayPal really captured this
 * payment and Saleor doesn't know yet" — saved immediately after a real
 * capture succeeds, before anything else that could fail gets a chance to
 * lose the order. Mirrors the Authorize.Net app's reconciliation table
 * (6.0-authorize-net-app/src/lib/reconciliation.ts) — same shape, same
 * reasoning, different gateway.
 *
 * Required schema:
 *
 *   CREATE TABLE IF NOT EXISTS paypal_reconciliation (
 *     id BIGSERIAL PRIMARY KEY,
 *     tenant TEXT NOT NULL,
 *     checkout_id TEXT NOT NULL,
 *     transaction_id TEXT NOT NULL,
 *     channel_id TEXT,
 *     paypal_order_id TEXT NOT NULL,
 *     amount NUMERIC NOT NULL,
 *     status TEXT NOT NULL DEFAULT 'pending',
 *     attempts INT NOT NULL DEFAULT 0,
 *     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 *     last_checked_at TIMESTAMPTZ,
 *     resolved_at TIMESTAMPTZ,
 *     note TEXT
 *   );
 *   CREATE INDEX IF NOT EXISTS paypal_reconciliation_pending
 *     ON paypal_reconciliation (status, last_checked_at);
 *   -- One pending row per PayPal order — a retried capture attempt on the
 *   -- same order shouldn't create duplicate reconciliation rows.
 *   CREATE UNIQUE INDEX IF NOT EXISTS paypal_reconciliation_order_pending
 *     ON paypal_reconciliation (tenant, paypal_order_id)
 *     WHERE status = 'pending';
 */

export type ReconciliationStatus =
  | "pending"
  | "resolved_success"
  | "resolved_failed"
  | "needs_review";

const GRACE_PERIOD_MS = 30_000;
const MAX_ATTEMPTS = 20;
const SWEEP_INTERVAL_MS = 60_000;

export interface PendingReconciliationArgs {
  tenant: string;
  checkoutId: string;
  transactionId: string;
  channelId?: string;
  paypalOrderId: string;
  amount: number;
}

export async function savePendingReconciliation(
  args: PendingReconciliationArgs,
): Promise<void> {
  try {
    await getPool().query(
      `INSERT INTO paypal_reconciliation
         (tenant, checkout_id, transaction_id, channel_id, paypal_order_id, amount)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (tenant, paypal_order_id) WHERE status = 'pending' DO NOTHING`,
      [args.tenant, args.checkoutId, args.transactionId, args.channelId ?? null, args.paypalOrderId, args.amount],
    );
    logger.info("Reconciliation row saved — will confirm with PayPal later", {
      checkoutId: args.checkoutId,
      paypalOrderId: args.paypalOrderId,
    });
  } catch (error) {
    logger.error("Reconciliation save failed", { error });
  }
}

/**
 * Called from the PayPal PAYMENT.CAPTURE.COMPLETED webhook — an independent
 * confirmation path that doesn't depend on our own outbound capture call
 * chain at all. This webhook is registered at the partner level (one
 * endpoint for every merchant), so it doesn't know which Saleor tenant an
 * order belongs to — look it up by paypal_order_id alone, which is unique
 * regardless of tenant. If a matching pending row exists, fast-track it so
 * the next sweep tick (rather than waiting a full interval) resolves it
 * immediately; if none exists, there's nothing to fast-track — the sweep
 * only ever acts on rows *we* created, so this is a no-op, not an error.
 */
export async function markOrderCapturedByWebhook(paypalOrderId: string): Promise<void> {
  try {
    const { rowCount } = await getPool().query(
      `UPDATE paypal_reconciliation
       SET last_checked_at = NULL -- force the next sweep tick to pick it up immediately
       WHERE paypal_order_id = $1 AND status = 'pending'`,
      [paypalOrderId],
    );
    if (rowCount) {
      logger.info("Fast-tracked reconciliation row from PAYMENT.CAPTURE.COMPLETED webhook", {
        paypalOrderId,
        rowCount,
      });
    }
  } catch (error) {
    logger.error("Failed to fast-track reconciliation row from webhook", { error, paypalOrderId });
  }
}

interface ReconciliationRow {
  id: number;
  tenant: string;
  checkout_id: string;
  transaction_id: string;
  channel_id: string | null;
  paypal_order_id: string;
  amount: string;
  attempts: number;
}

async function fetchDueRows(): Promise<ReconciliationRow[]> {
  const { rows } = await getPool().query(
    `SELECT id, tenant, checkout_id, transaction_id, channel_id, paypal_order_id, amount, attempts
     FROM paypal_reconciliation
     WHERE status = 'pending'
       AND (
         last_checked_at IS NULL
         OR (created_at < NOW() - ($1 || ' milliseconds')::INTERVAL
             AND last_checked_at < NOW() - ($2 || ' milliseconds')::INTERVAL)
       )
     ORDER BY created_at ASC
     LIMIT 50`,
    [GRACE_PERIOD_MS, SWEEP_INTERVAL_MS],
  );
  return rows as ReconciliationRow[];
}

async function markRow(id: number, status: ReconciliationStatus, note?: string): Promise<void> {
  await getPool().query(
    `UPDATE paypal_reconciliation
     SET status = $2,
         last_checked_at = NOW(),
         resolved_at = CASE WHEN $2 != 'pending' THEN NOW() ELSE resolved_at END,
         attempts = attempts + 1,
         note = COALESCE($3, note)
     WHERE id = $1`,
    [id, status, note ?? null],
  );
}

async function finishOrder(
  saleorApiUrl: string,
  token: string,
  row: ReconciliationRow,
  captureId: string,
): Promise<{ ok: true } | { ok: false; terminal: boolean; message: string }> {
  const client = createGraphQLClient(saleorApiUrl, token);

  const reportResult = await client
    .mutation(
      `mutation ReportChargeSuccess($id: ID!, $pspReference: String!, $amount: PositiveDecimal!) {
        transactionEventReport(
          id: $id
          type: CHARGE_SUCCESS
          pspReference: $pspReference
          amount: $amount
        ) {
          alreadyProcessed
          errors { field message code }
        }
      }`,
      { id: row.transaction_id, pspReference: captureId, amount: Number(row.amount) },
    )
    .toPromise();

  const reportErrors = reportResult.data?.transactionEventReport?.errors ?? [];
  if (reportResult.error || reportErrors.length > 0) {
    return {
      ok: false,
      terminal: false,
      message: `transactionEventReport failed: ${reportResult.error?.message ?? JSON.stringify(reportErrors)}`,
    };
  }

  const completeResult = await client
    .mutation(
      `mutation FinishCheckout($id: ID!) {
        checkoutComplete(id: $id) {
          order { id number }
          errors { field message code }
        }
      }`,
      { id: row.checkout_id },
    )
    .toPromise();

  const completeErrors = completeResult.data?.checkoutComplete?.errors ?? [];
  const order = completeResult.data?.checkoutComplete?.order;
  const alreadyCompleted = completeErrors.some((e: { code?: string }) =>
    ["CHECKOUT_NOT_FOUND", "ORDER_ALREADY_EXISTS"].includes(e.code ?? ""),
  );
  // Terminal: retrying won't help — e.g. NO_LINES means the checkout's stock
  // reservation lapsed (or the cart was otherwise emptied) before we got
  // here. The charge is still real money with no order; flag for a human
  // instead of looping on a checkout that can't be completed as-is.
  const terminal = completeErrors.some((e: { code?: string }) =>
    ["NO_LINES", "INSUFFICIENT_STOCK", "VOUCHER_NOT_APPLICABLE", "SHIPPING_METHOD_NOT_SET", "BILLING_ADDRESS_NOT_SET", "SHIPPING_ADDRESS_NOT_SET"].includes(e.code ?? ""),
  );

  if (completeResult.error || (completeErrors.length > 0 && !alreadyCompleted)) {
    return {
      ok: false,
      terminal,
      message: `checkoutComplete failed: ${completeResult.error?.message ?? JSON.stringify(completeErrors)}`,
    };
  }

  logger.info("Reconciliation resolved checkout", {
    checkoutId: row.checkout_id,
    orderNumber: order?.number ?? "(already existed)",
  });
  return { ok: true };
}

async function processRow(row: ReconciliationRow): Promise<void> {
  const authData = await saleorApp.apl.get(row.tenant);
  if (!authData) {
    await markRow(row.id, "needs_review", "Tenant auth data unavailable during reconciliation");
    return;
  }

  const configResult = await paypalConfigRepo.getPayPalConfig(authData, row.channel_id ?? undefined);
  if (configResult.isErr() || !configResult.value) {
    await markRow(row.id, "needs_review", "PayPal config unavailable during reconciliation");
    return;
  }
  const config = configResult.value;

  const ordersApi = new PayPalOrdersApiFactory().create({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    merchantId: config.merchantId ? (config.merchantId as any) : undefined,
    merchantEmail: config.merchantEmail || undefined,
    env: config.environment,
  });

  const orderResult = await ordersApi.getOrder({
    orderId: createPayPalOrderId(row.paypal_order_id),
  });

  if (orderResult.isErr()) {
    if (row.attempts + 1 >= MAX_ATTEMPTS) {
      await markRow(row.id, "needs_review", `PayPal order lookup kept failing: ${String(orderResult.error)}`);
    } else {
      await markRow(row.id, "pending", `Lookup error (attempt ${row.attempts + 1}): ${String(orderResult.error)}`);
    }
    return;
  }

  const outcome = interpretCaptureResponse(orderResult.value);

  if (outcome.kind === "declined" || outcome.kind === "missing") {
    await markRow(
      row.id,
      "resolved_failed",
      `PayPal outcome: ${outcome.kind} — correctly no order.`,
    );
    return;
  }

  if (outcome.kind === "pending") {
    if (row.attempts + 1 >= MAX_ATTEMPTS) {
      await markRow(row.id, "needs_review", "PayPal capture stuck pending after max attempts");
    } else {
      await markRow(row.id, "pending", "PayPal capture still pending");
    }
    return;
  }

  // outcome.kind === "succeeded": the capture is real. Finish the job.
  const outcomeResult = await finishOrder(row.tenant, authData.token, row, outcome.captureId);
  if (outcomeResult.ok) {
    await markRow(row.id, "resolved_success", `PayPal captureId ${outcome.captureId}`);
  } else if (outcomeResult.terminal || row.attempts + 1 >= MAX_ATTEMPTS) {
    await markRow(row.id, "needs_review", outcomeResult.message);
  } else {
    await markRow(row.id, "pending", outcomeResult.message);
  }
}

export async function sweepPendingReconciliations(): Promise<void> {
  let rows: ReconciliationRow[];
  try {
    rows = await fetchDueRows();
  } catch (error) {
    logger.error("Sweep: failed to fetch due rows", { error });
    return;
  }

  for (const row of rows) {
    try {
      await processRow(row);
    } catch (error) {
      logger.error("Sweep: error processing row", { error, rowId: row.id });
    }
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __paypalReconciliationSweepStarted: boolean | undefined;
}

export function startReconciliationSweep(): void {
  if (globalThis.__paypalReconciliationSweepStarted) return;
  globalThis.__paypalReconciliationSweepStarted = true;

  setInterval(() => {
    sweepPendingReconciliations().catch((error) => {
      logger.error("Sweep tick failed", { error });
    });
  }, SWEEP_INTERVAL_MS);

  logger.info(`PayPal reconciliation sweep started (every ${SWEEP_INTERVAL_MS / 1000}s).`);
}
