import { getPool } from "./database";

/**
 * Idempotency store for sync webhook handlers — gateway-agnostic by design
 * (a `gateway` column instead of a gateway-specific table name), so if a
 * shared payment-apps package is ever built, this data layer doesn't need
 * to change — only the thin per-app wrapper (this file) would move.
 * Mirrors the shape of 6.0-authorize-net-app/src/lib/idempotency.ts.
 *
 * Persists the first response for a given key so a Saleor webhook retry
 * returns the same payload instead of re-attempting an action PayPal (or
 * whichever gateway) already completed. See WSM6-1373 follow-up
 * (2026-07-30): a transaction-process-session retry after a
 * slow-but-successful capture was turning into a false CHARGE_FAILURE,
 * because PayPal correctly rejects the second capture attempt
 * (ORDER_ALREADY_CAPTURED) even though the payment had already succeeded.
 *
 * Note: TRANSACTION_PROCESS_SESSION has no `idempotencyKey` field on its
 * own GraphQL event type (unlike TRANSACTION_INITIALIZE_SESSION, which
 * does) — callers of this module derive their own stable key instead
 * (e.g. transaction id + action type + amount).
 */
let schemaReadyPromise: Promise<void> | null = null;

function ensureSchema(): Promise<void> {
  if (!schemaReadyPromise) {
    schemaReadyPromise = getPool()
      .query(
        `CREATE TABLE IF NOT EXISTS webhook_idempotency (
           gateway TEXT NOT NULL,
           tenant TEXT NOT NULL,
           idempotency_key TEXT NOT NULL,
           response JSONB NOT NULL,
           created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
           PRIMARY KEY (gateway, tenant, idempotency_key)
         );`,
      )
      .then(() => undefined)
      .catch((error) => {
        schemaReadyPromise = null;
        throw error;
      });
  }

  return schemaReadyPromise;
}

const GATEWAY = "paypal";

export async function getCachedIdempotentResponse(
  tenant: string,
  key: string | undefined | null,
): Promise<unknown | null> {
  if (!key) return null;
  try {
    await ensureSchema();
    const result = await getPool().query(
      "SELECT response FROM webhook_idempotency WHERE gateway = $1 AND tenant = $2 AND idempotency_key = $3",
      [GATEWAY, tenant, key],
    );

    return result.rows[0]?.response ?? null;
  } catch (error) {
    console.error("idempotency get error:", error);

    return null;
  }
}

export async function storeIdempotentResponse(
  tenant: string,
  key: string | undefined | null,
  response: unknown,
): Promise<void> {
  if (!key) return;
  try {
    await ensureSchema();
    await getPool().query(
      `INSERT INTO webhook_idempotency (gateway, tenant, idempotency_key, response)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (gateway, tenant, idempotency_key) DO NOTHING`,
      [GATEWAY, tenant, key, JSON.stringify(response)],
    );
  } catch (error) {
    console.error("idempotency store error:", error);
  }
}
