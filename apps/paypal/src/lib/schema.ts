import { getPool } from "@/lib/database";

/**
 * Tables this app provisions at startup, applied in one transaction by the
 * Next.js `register()` hook in `src/instrumentation.ts`.
 *
 * Why this exists rather than a manual migration step: `payment-attempt-lock.ts`
 * fails *open*, so a missing `payment_attempt_lock` table doesn't fail the
 * deploy — it silently disables double-payment protection while logging
 * "relation payment_attempt_lock does not exist" on every request and charging
 * anyway. Observed in production on the Authorize.net app, which had the same
 * gap; this is the mirror fix (see 6.0-authorize-net-app/src/lib/schema.ts).
 *
 * Scope note: `payment_attempt_lock` is deliberately NOT added to
 * `initializeDatabase()` in `database.ts`. That function is only reachable via
 * the manual `pnpm migrate:database` script and provisions seven other tables;
 * wiring it into startup would change provisioning behavior for all of them.
 * This covers only the table whose absence breaks a payment guard.
 *
 * The table is intentionally shared with the Authorize.net app via the common
 * Postgres instance — not namespaced per-app — so a concurrent attempt on the
 * same checkout through a *different* gateway is caught too. Both apps declare
 * it with identical, idempotent DDL; whichever boots first creates it.
 */
const STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS payment_attempt_lock (
     checkout_id TEXT PRIMARY KEY,
     locked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
];

let provisionPromise: Promise<void> | null = null;

/**
 * Creates the tables above in a single transaction. Cached per-process, so the
 * startup hook pays the cost and later callers get the resolved promise. A
 * failure clears the cache rather than poisoning it forever, letting the next
 * caller retry.
 */
export const provisionSchema = (): Promise<void> => {
  if (!provisionPromise) {
    provisionPromise = run().catch((error) => {
      provisionPromise = null;
      throw error;
    });
  }

  return provisionPromise;
};

const run = async (): Promise<void> => {
  const client = await getPool().connect();

  try {
    await client.query("BEGIN");
    for (const statement of STATEMENTS) {
      await client.query(statement);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};
