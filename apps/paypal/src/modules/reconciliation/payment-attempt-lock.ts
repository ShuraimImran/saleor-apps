import { getPool } from "@/lib/database";
import { provisionSchema } from "@/lib/schema";

/**
 * Concurrency guard for two tabs/requests paying the same checkout at once
 * (double-payment prevention — ported from wsm-app-platform's
 * saleor_app_framework/payment_lock.py / PaymentAttemptLock). Mirrors the
 * Authorize.net app's equivalent (src/lib/payment-attempt-lock.ts) and
 * shares the SAME table via the common Postgres instance, so a concurrent
 * attempt on the same checkout via a *different* gateway is also caught.
 *
 * Deliberately short-lived (~30s) — only needs to cover an actual in-flight
 * request, not the longer async-reconciliation window (see
 * wsm-app-platform/docs/double-payment-gap.md for that gap).
 *
 * The `payment_attempt_lock` table is provisioned at startup by
 * `lib/schema.ts#provisionSchema` rather than a manual migration step: this
 * guard fails *open*, so a missed migration silently disables double-payment
 * protection while every request logs "relation payment_attempt_lock does not
 * exist" and charges anyway.
 */

const STALE_AFTER_MS = 30_000;

export class LockBusyError extends Error {
  constructor() {
    super("Another payment attempt is already being processed for this order.");
    this.name = "LockBusyError";
  }
}

async function acquire(checkoutId: string): Promise<void> {
  /*
   * Normally a no-op resolved promise (startup already provisioned); this is
   * the fallback for a boot where provisioning failed.
   */
  await provisionSchema();

  const pool = getPool();

  const inserted = await pool.query(
    `INSERT INTO payment_attempt_lock (checkout_id) VALUES ($1)
     ON CONFLICT (checkout_id) DO NOTHING
     RETURNING checkout_id`,
    [checkoutId],
  );
  if (inserted.rowCount) return; // first attempt, got it

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT locked_at FROM payment_attempt_lock WHERE checkout_id = $1 FOR UPDATE`,
      [checkoutId],
    );
    const lockedAt = rows[0]?.locked_at ? new Date(rows[0].locked_at).getTime() : 0;
    if (Date.now() - lockedAt < STALE_AFTER_MS) {
      await client.query("ROLLBACK");
      throw new LockBusyError();
    }
    await client.query(
      `UPDATE payment_attempt_lock SET locked_at = NOW() WHERE checkout_id = $1`,
      [checkoutId],
    );
    await client.query("COMMIT");
  } catch (err) {
    if (!(err instanceof LockBusyError)) {
      await client.query("ROLLBACK").catch(() => {});
    }
    throw err;
  } finally {
    client.release();
  }
}

async function release(checkoutId: string): Promise<void> {
  try {
    await getPool().query(`DELETE FROM payment_attempt_lock WHERE checkout_id = $1`, [checkoutId]);
  } catch (error) {
    console.error("payment-attempt-lock release failed:", error);
  }
}

/**
 * Runs `fn` only while holding the lock for `checkoutId`; releases it
 * afterward regardless of outcome. Calls `onBusy` instead if another
 * attempt already holds a fresh (<30s) lock.
 */
export async function withPaymentLock<T>(
  checkoutId: string | undefined,
  fn: () => Promise<T>,
  onBusy: () => T,
): Promise<T> {
  if (!checkoutId) return fn();

  try {
    await acquire(checkoutId);
  } catch (err) {
    if (err instanceof LockBusyError) return onBusy();
    console.error("payment-attempt-lock acquire failed (proceeding unguarded):", err);
    return fn();
  }

  try {
    return await fn();
  } finally {
    await release(checkoutId);
  }
}
