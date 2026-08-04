#!/usr/bin/env tsx
/**
 * Read-only report of PayPal reconciliation sweep candidates.
 *
 * A "candidate" is a durable record of "PayPal really captured this payment and
 * Saleor may not know about it": a row in `paypal_reconciliation` with status
 * `pending` or `needs_review`. Those are exactly the rows the background sweep
 * acts on (src/modules/reconciliation/reconciliation.ts#sweepPendingReconciliations)
 * — this script reports them, with enough customer and tracing detail to work
 * each one by hand, and changes nothing.
 *
 * Scoped to this app's own gateway and its own table. The Authorize.Net app has
 * its own equivalent script for `authorize_net_reconciliation`
 * (6.0-authorize-net-app/scripts/report-sweep-candidates.ts); run both if you
 * are chasing a customer who may have been double-charged across gateways,
 * since the cross-gateway guard
 * (src/modules/reconciliation/cross-gateway-guard.ts) treats a pending row on
 * either side as blocking.
 *
 * READ-ONLY, TWO WAYS:
 *   - Every DB statement runs inside `BEGIN TRANSACTION READ ONLY`, so a stray
 *     write is rejected by Postgres rather than by code review. Table presence
 *     is probed with `to_regclass` instead of catching "relation does not
 *     exist", because a failed statement would poison the transaction.
 *   - Saleor is only ever sent `query` documents, never a mutation. Nothing
 *     here calls transactionEventReport / checkoutComplete / orderUpdate the
 *     way the real sweep does. PayPal's own API is never called either, so a
 *     capture's gateway-side status still has to be confirmed in the PayPal
 *     dashboard using the order id reported below.
 *   It deliberately does NOT import this app's own modules: reconciliation.ts
 *   (via `ensureSchema()`) and lib/database.ts (`initializeDatabase()`)
 *   provision tables on use (DDL is a write), so the script talks to `pg`
 *   directly.
 *
 * PERMISSIONS: uses `transaction(id:)` and `checkout(id:)`, both covered by the
 * HANDLE_PAYMENTS grant this app already declares in
 * src/app/api/manifest/route.ts. It deliberately avoids the `checkouts(...)`
 * list query, which needs MANAGE_CHECKOUTS — a permission this app does not ask
 * for, so it fails with PermissionDenied against a real install.
 *
 * Usage (env loaded from .env, same as `pnpm migrate:database`):
 *   pnpm report:sweep-candidates
 *   pnpm report:sweep-candidates -- --days=7
 *   pnpm report:sweep-candidates -- --format=csv > candidates.csv
 *   pnpm report:sweep-candidates -- --format=json | jq '.candidates[]'
 *   pnpm report:sweep-candidates -- --no-saleor   # DB only, no network
 *
 * Requires the usual DB_* env vars (DB_HOST, DB_PORT, DB_NAME, DB_USER,
 * DB_PASSWORD).
 *
 * The report goes to stdout; progress and warnings go to stderr, so
 * --format=json and --format=csv can be piped straight into other tools.
 *
 * cspell:words regclass MVCC
 */
import { Pool, type PoolClient } from "pg";

const GATEWAY = "paypal";
const RECONCILIATION_TABLE = "paypal_reconciliation";

/**
 * `app_name` under which this app stores its APL rows — hardcoded to "PayPal"
 * in src/lib/saleor-app.ts, overridable here only for odd deployments.
 */
const APP_NAME = process.env.SWEEP_APP_NAME ?? "PayPal";

/** Saleor's own names for a charge that landed — see reconciliation.ts. */
const SUCCESS_EVENT_TYPES = ["CHARGE_SUCCESS", "AUTHORIZATION_SUCCESS"];

// ---------------------------------------------------------------- CLI

interface Options {
  statuses: string[];
  minAgeMinutes: number;
  days: number;
  limit: number;
  format: "text" | "json" | "csv";
  enrichFromSaleor: boolean;
  includeLocks: boolean;
  failOnFindings: boolean;
}

const HELP = `
Read-only report of PayPal reconciliation sweep candidates.

  --status=<a,b>             Row statuses to include (default: pending,needs_review)
  --min-age-minutes=<n>      Only rows at least this old (default: 0)
  --days=<n>                 Lookback window on created_at (default: 30)
  --limit=<n>                Max rows (default: 500)
  --format=<text|json|csv>   Output format (default: text)
  --no-saleor                Skip Saleor enrichment (DB fields only)
  --no-locks                 Skip the leaked payment-lock section
  --fail-on-findings         Exit 1 if anything needs manual action
  --help                     Show this

Nothing is written to Postgres, Saleor or PayPal. Authorize.Net candidates are
reported by that app's own script
(6.0-authorize-net-app/scripts/report-sweep-candidates.ts).
`;

function parseOptions(argv: string[]): Options {
  const value = (name: string): string | undefined => {
    const hit = argv.find((arg) => arg.startsWith(`--${name}=`));

    return hit ? hit.slice(name.length + 3) : undefined;
  };
  const flag = (name: string): boolean => argv.includes(`--${name}`);

  const format = value("format") ?? "text";

  if (!["text", "json", "csv"].includes(format)) {
    throw new Error(`--format must be one of: text, json, csv`);
  }

  const positiveNumber = (name: string, fallback: number): number => {
    const raw = value(name);

    if (raw === undefined) return fallback;
    const parsed = Number(raw);

    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new Error(`--${name} must be a non-negative number`);
    }

    return parsed;
  };

  return {
    statuses: (value("status") ?? "pending,needs_review")
      .split(",")
      .map((status) => status.trim())
      .filter(Boolean),
    minAgeMinutes: positiveNumber("min-age-minutes", 0),
    days: positiveNumber("days", 30),
    limit: positiveNumber("limit", 500),
    format: format as Options["format"],
    enrichFromSaleor: !flag("no-saleor"),
    includeLocks: !flag("no-locks"),
    failOnFindings: flag("fail-on-findings"),
  };
}

// ---------------------------------------------------------------- shapes

/** One row of `paypal_reconciliation` — see src/lib/database.ts. */
interface ReconciliationRow {
  id: string;
  tenant: string;
  checkout_id: string;
  transaction_id: string;
  channel_id: string | null;
  paypal_order_id: string;
  amount: string;
  status: string;
  attempts: number;
  created_at: string;
  last_checked_at: string | null;
  resolved_at: string | null;
  note: string | null;
}

interface SaleorTransaction {
  pspReference: string | null;
  name: string | null;
  message: string | null;
  createdAt: string | null;
  chargedAmount: { amount: number; currency: string } | null;
  authorizedAmount: { amount: number; currency: string } | null;
  refundedAmount: { amount: number; currency: string } | null;
  events: Array<{
    type: string | null;
    pspReference: string | null;
    createdAt: string;
    message: string | null;
    amount: { amount: number; currency: string } | null;
  }>;
  order: {
    id: string;
    number: string;
    created: string;
    status: string;
    userEmail: string | null;
    total: { gross: { amount: number; currency: string } } | null;
    totalBalance: { amount: number; currency: string } | null;
  } | null;
}

interface SaleorCheckout {
  email: string | null;
  created: string | null;
  lastChange: string | null;
  channel: { slug: string } | null;
  authorizeStatus: string | null;
  chargeStatus: string | null;
  totalPrice: { gross: { amount: number; currency: string } } | null;
  totalBalance: { amount: number; currency: string } | null;
  billingAddress: {
    firstName: string | null;
    lastName: string | null;
    companyName: string | null;
    phone: string | null;
    city: string | null;
    countryArea: string | null;
    postalCode: string | null;
    country: { code: string } | null;
  } | null;
  shippingAddress: { firstName: string | null; lastName: string | null; phone: string | null } | null;
  user: { email: string | null; firstName: string | null; lastName: string | null } | null;
  lines: Array<{ quantity: number; variant: { name: string | null; sku: string | null } | null }>;
  metadata: Array<{ key: string; value: string }>;
}

/** What the sweep will do with this row, and what a human should do. */
type Verdict =
  | "NEEDS_SWEEP"
  | "NEEDS_MANUAL_REVIEW"
  | "ORDER_ALREADY_EXISTS"
  | "CHECKOUT_GONE"
  | "UNKNOWN";

interface Candidate {
  row: ReconciliationRow;
  transaction: SaleorTransaction | null;
  checkout: SaleorCheckout | null;
  saleorErrors: string[];
  verdict: Verdict;
  reason: string;
}

interface LeakedLock {
  checkout_id: string;
  locked_at: string;
  ageMinutes: number;
  hasReconciliationRow: boolean;
}

// ---------------------------------------------------------------- utils

const note = (message: string): void => {
  process.stderr.write(`${message}\n`);
};

const minutesSince = (isoTimestamp: string): number =>
  (Date.now() - new Date(isoTimestamp).getTime()) / 60_000;

function humanAge(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)}m ago`;
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}h ${Math.round(minutes % 60)}m ago`;
  const days = Math.floor(minutes / (60 * 24));

  return `${days}d ${Math.floor((minutes % (60 * 24)) / 60)}h ago`;
}

function money(amount: number | string | null | undefined, currency?: string | null): string {
  if (amount === null || amount === undefined || amount === "") return "—";
  const numeric = typeof amount === "string" ? Number(amount) : amount;

  if (!Number.isFinite(numeric)) return String(amount);

  return `${numeric.toFixed(2)} ${currency ?? "?"}`;
}

/** Bounded concurrency — quick enough to be useful, gentle on Saleor. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next++;

      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  });

  await Promise.all(workers);

  return results;
}

// ---------------------------------------------------------------- database

function createPool(): Pool {
  const missing = ["DB_HOST", "DB_NAME", "DB_USER", "DB_PASSWORD"].filter((key) => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }

  return new Pool({
    host: process.env.DB_HOST,
    port: Number.parseInt(process.env.DB_PORT || "5432", 10),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    // Mirrors src/lib/database.ts#getSslConfig for this read-only use.
    ssl: process.env.DB_SSL === "false" ? false : { rejectUnauthorized: false },
  });
}

/**
 * `to_regclass` returns NULL instead of raising for a missing relation, which
 * matters inside a transaction: an error would abort it and every later
 * statement would fail with 25P02.
 */
async function tableExists(client: PoolClient, table: string): Promise<boolean> {
  const { rows } = await client.query<{ present: boolean }>(
    `SELECT to_regclass($1) IS NOT NULL AS present`,
    [table],
  );

  return rows[0]?.present === true;
}

interface DbSnapshot {
  rows: ReconciliationRow[];
  tokensByTenant: Map<string, string>;
  leakedLocks: LeakedLock[];
  missingTables: string[];
  knownAppNames: string[];
}

/**
 * Everything the report needs from Postgres, in one short read-only
 * transaction. Deliberately finished *before* any Saleor HTTP call, so no
 * connection or MVCC snapshot is held open across the network.
 */
async function readDatabase(pool: Pool, options: Options): Promise<DbSnapshot> {
  const client = await pool.connect();
  const missingTables: string[] = [];

  try {
    await client.query("BEGIN TRANSACTION READ ONLY");

    let rows: ReconciliationRow[] = [];

    if (await tableExists(client, RECONCILIATION_TABLE)) {
      const { rows: found } = await client.query<ReconciliationRow>(
        `SELECT id::text, tenant, checkout_id, transaction_id, channel_id, paypal_order_id,
                amount::text, status, attempts, created_at, last_checked_at, resolved_at, note
         FROM ${RECONCILIATION_TABLE}
         WHERE status = ANY($1)
           AND created_at >= NOW() - ($2 || ' days')::INTERVAL
           AND created_at <= NOW() - ($3 || ' minutes')::INTERVAL
         ORDER BY created_at DESC
         LIMIT $4`,
        [options.statuses, String(options.days), String(options.minAgeMinutes), options.limit],
      );

      rows = found;
    } else {
      missingTables.push(RECONCILIATION_TABLE);
    }

    /*
     * Per-tenant Saleor tokens, straight out of the APL table — the same rows
     * the app itself reads via PostgresAPL.
     */
    const tokensByTenant = new Map<string, string>();
    let knownAppNames: string[] = [];

    if (await tableExists(client, "saleor_app_configuration")) {
      const { rows: aplRows } = await client.query<{
        tenant: string;
        configurations: { token?: string } | null;
      }>(
        `SELECT tenant, configurations
         FROM saleor_app_configuration
         WHERE app_name = $1 AND is_active = TRUE`,
        [APP_NAME],
      );

      for (const aplRow of aplRows) {
        const token = aplRow.configurations?.token;

        if (token) tokensByTenant.set(aplRow.tenant, token);
      }

      // Only needed to make a "no tenants matched" result diagnosable.
      const { rows: nameRows } = await client.query<{ app_name: string }>(
        `SELECT DISTINCT app_name FROM saleor_app_configuration WHERE is_active = TRUE ORDER BY app_name`,
      );

      knownAppNames = nameRows.map((nameRow) => nameRow.app_name);
    } else {
      missingTables.push("saleor_app_configuration");
    }

    /*
     * Locks are released in a `finally` (payment-attempt-lock.ts), so a row
     * older than the 30s staleness window means a process died mid-payment.
     * The table is shared with the Authorize.Net app and carries no gateway
     * column, so a leaked lock listed here may belong to either app.
     */
    const leakedLocks: LeakedLock[] = [];

    if (options.includeLocks && (await tableExists(client, "payment_attempt_lock"))) {
      const { rows: lockRows } = await client.query<{ checkout_id: string; locked_at: string }>(
        `SELECT checkout_id, locked_at
         FROM payment_attempt_lock
         WHERE locked_at < NOW() - INTERVAL '5 minutes'
         ORDER BY locked_at DESC
         LIMIT 200`,
      );
      const checkoutsWithRows = new Set(rows.map((row) => row.checkout_id));

      for (const lockRow of lockRows) {
        leakedLocks.push({
          checkout_id: lockRow.checkout_id,
          locked_at: lockRow.locked_at,
          ageMinutes: minutesSince(lockRow.locked_at),
          hasReconciliationRow: checkoutsWithRows.has(lockRow.checkout_id),
        });
      }
    }

    await client.query("COMMIT");

    return { rows, tokensByTenant, leakedLocks, missingTables, knownAppNames };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------- saleor

interface GraphQLResponse<T> {
  data?: T | null;
  errors?: Array<{ message: string }>;
}

/**
 * Returns partial data alongside errors rather than throwing on the first one:
 * a candidate whose transaction is unreadable is still worth reporting with
 * whatever the checkout gave us.
 */
async function saleorQuery<T>(
  tenant: { saleorApiUrl: string; token: string },
  query: string,
  variables: Record<string, unknown>,
): Promise<{ data: T | null; errors: string[] }> {
  try {
    const response = await fetch(tenant.saleorApiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tenant.token}` },
      body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
      return { data: null, errors: [`HTTP ${response.status} ${response.statusText}`] };
    }

    const body = (await response.json()) as GraphQLResponse<T>;

    return {
      data: body.data ?? null,
      errors: (body.errors ?? []).map((error) => error.message),
    };
  } catch (error) {
    return { data: null, errors: [error instanceof Error ? error.message : String(error)] };
  }
}

const TRANSACTION_QUERY = `query SweepCandidateTransaction($id: ID!) {
  transaction(id: $id) {
    pspReference
    name
    message
    createdAt
    chargedAmount { amount currency }
    authorizedAmount { amount currency }
    refundedAmount { amount currency }
    events { type pspReference createdAt message amount { amount currency } }
    order {
      id
      number
      created
      status
      userEmail
      total { gross { amount currency } }
      totalBalance { amount currency }
    }
  }
}`;

const CHECKOUT_QUERY = `query SweepCandidateCheckout($id: ID!) {
  checkout(id: $id) {
    email
    created
    lastChange
    channel { slug }
    authorizeStatus
    chargeStatus
    totalPrice { gross { amount currency } }
    totalBalance { amount currency }
    billingAddress {
      firstName lastName companyName phone city countryArea postalCode country { code }
    }
    shippingAddress { firstName lastName phone }
    user { email firstName lastName }
    lines { quantity variant { name sku } }
    metadata { key value }
  }
}`;

/**
 * Same fields minus `lines.variant`, which resolves a ProductVariant and can
 * fail for a since-unpublished product — losing the customer details along with
 * it. Used as a fallback so one bad line item cannot blank out a row.
 */
const CHECKOUT_QUERY_MINIMAL = `query SweepCandidateCheckoutMinimal($id: ID!) {
  checkout(id: $id) {
    email
    created
    lastChange
    channel { slug }
    authorizeStatus
    chargeStatus
    totalPrice { gross { amount currency } }
    totalBalance { amount currency }
    billingAddress {
      firstName lastName companyName phone city countryArea postalCode country { code }
    }
    shippingAddress { firstName lastName phone }
    user { email firstName lastName }
    lines { quantity }
    metadata { key value }
  }
}`;

async function enrich(
  row: ReconciliationRow,
  token: string,
): Promise<{ transaction: SaleorTransaction | null; checkout: SaleorCheckout | null; errors: string[] }> {
  const tenant = { saleorApiUrl: row.tenant, token };
  const [transactionResult, checkoutResult] = await Promise.all([
    saleorQuery<{ transaction: SaleorTransaction | null }>(tenant, TRANSACTION_QUERY, {
      id: row.transaction_id,
    }),
    saleorQuery<{ checkout: SaleorCheckout | null }>(tenant, CHECKOUT_QUERY, {
      id: row.checkout_id,
    }),
  ]);

  const errors = [
    ...transactionResult.errors.map((message) => `transaction: ${message}`),
    ...checkoutResult.errors.map((message) => `checkout: ${message}`),
  ];

  let checkout = checkoutResult.data?.checkout ?? null;

  if (!checkout && checkoutResult.errors.length > 0) {
    const retry = await saleorQuery<{ checkout: SaleorCheckout | null }>(tenant, CHECKOUT_QUERY_MINIMAL, {
      id: row.checkout_id,
    });

    if (retry.data?.checkout) {
      checkout = { ...retry.data.checkout, lines: retry.data.checkout.lines ?? [] };
      errors.push("checkout: retried without line-item variant details");
    }
  }

  return { transaction: transactionResult.data?.transaction ?? null, checkout, errors };
}

// ---------------------------------------------------------------- verdict

/**
 * Why a row may carry no Saleor detail — the distinction matters, because a
 * missing APL token is a real deployment problem worth naming, not the same as
 * the operator having asked for a DB-only report.
 */
type Enrichment = "done" | "skipped" | "no-token";

function decide(
  row: ReconciliationRow,
  saleor: { transaction: SaleorTransaction | null; checkout: SaleorCheckout | null },
  enrichment: Enrichment,
): { verdict: Verdict; reason: string } {
  const { transaction, checkout } = saleor;

  if (enrichment === "skipped") {
    return {
      verdict: "UNKNOWN",
      reason: "Saleor enrichment skipped (--no-saleor) — cannot tell whether an order exists.",
    };
  }

  if (enrichment === "no-token") {
    return {
      verdict: "UNKNOWN",
      reason: `No stored Saleor token for this tenant under app_name "${APP_NAME}" — the app may have been uninstalled or reinstalled under another name. Cannot tell whether an order exists.`,
    };
  }

  if (transaction?.order) {
    return {
      verdict: "ORDER_ALREADY_EXISTS",
      reason: `Order #${transaction.order.number} already exists — the money is accounted for. Row is stale; the sweep skips it via its existing-success-event check.`,
    };
  }

  const hasSuccessEvent = (transaction?.events ?? []).some(
    (event) => event.type !== null && SUCCESS_EVENT_TYPES.includes(event.type),
  );

  if (!checkout && !transaction) {
    return {
      verdict: "CHECKOUT_GONE",
      reason:
        "Neither the checkout nor the transaction is readable in Saleor — the checkout was likely deleted or expired. If the capture completed at PayPal this is a refund, not a sweep.",
    };
  }

  if (!checkout) {
    return {
      verdict: "CHECKOUT_GONE",
      reason:
        "Checkout no longer exists in Saleor, so checkoutComplete can never succeed. Confirm the capture in the PayPal dashboard by order id and refund or re-key the order by hand.",
    };
  }

  if (row.status === "needs_review") {
    return {
      verdict: "NEEDS_MANUAL_REVIEW",
      reason: `Sweep gave up after ${row.attempts} attempt(s) — it will not retry. ${
        hasSuccessEvent
          ? "Saleor already has a success event, so only order creation is missing."
          : "No success event on the transaction; confirm in the PayPal dashboard whether the capture completed."
      }`,
    };
  }

  return {
    verdict: "NEEDS_SWEEP",
    reason: hasSuccessEvent
      ? "Saleor already knows about the capture; the sweep still needs to create the order."
      : "Still pending PayPal confirmation — the sweep will re-check on its next tick.",
  };
}

/** Verdicts that mean a person has to do something. */
const ACTIONABLE: Verdict[] = ["NEEDS_MANUAL_REVIEW", "CHECKOUT_GONE"];

// ---------------------------------------------------------------- shaping

function customerName(checkout: SaleorCheckout | null): string {
  const candidates = [
    [checkout?.billingAddress?.firstName, checkout?.billingAddress?.lastName],
    [checkout?.shippingAddress?.firstName, checkout?.shippingAddress?.lastName],
    [checkout?.user?.firstName, checkout?.user?.lastName],
  ];

  for (const [first, last] of candidates) {
    const name = [first, last].filter(Boolean).join(" ").trim();

    if (name) return name;
  }

  return checkout?.billingAddress?.companyName?.trim() || "—";
}

function customerEmail(candidate: Candidate): string {
  return (
    candidate.checkout?.email ||
    candidate.checkout?.user?.email ||
    candidate.transaction?.order?.userEmail ||
    "—"
  );
}

/**
 * The app records the PayPal order id, not the funding source, so the Saleor
 * transaction's own name is the closest thing to a wallet/card label. The real
 * instrument is only visible in the PayPal dashboard for that order id.
 */
function paymentMethod(candidate: Candidate): string {
  const label = candidate.transaction?.name?.trim();

  return label ? `PayPal (${label})` : "PayPal (funding source not recorded locally)";
}

/** Every identifier that makes this traceable in a support ticket. */
function traceRefs(candidate: Candidate): Array<[string, string]> {
  const { row } = candidate;
  const refs: Array<[string, string]> = [["saleor.transaction", row.transaction_id]];

  const psp =
    candidate.transaction?.pspReference ||
    candidate.transaction?.events.find((event) => event.pspReference)?.pspReference;

  if (psp) refs.push(["saleor.pspReference", psp]);
  refs.push(["paypal.orderId", row.paypal_order_id]);
  if (row.channel_id) refs.push(["saleor.channelId", row.channel_id]);
  refs.push([`${RECONCILIATION_TABLE}.id`, row.id]);

  return refs;
}

function currencyOf(candidate: Candidate): string | null {
  return (
    candidate.checkout?.totalPrice?.gross?.currency ??
    candidate.transaction?.chargedAmount?.currency ??
    candidate.transaction?.authorizedAmount?.currency ??
    candidate.transaction?.order?.total?.gross?.currency ??
    null
  );
}

// ---------------------------------------------------------------- rendering

function renderText(candidates: Candidate[], snapshot: DbSnapshot, options: Options): string {
  const out: string[] = [];
  const write = (line = ""): void => void out.push(line);
  const LABEL_WIDTH = 17;
  /** Always leaves at least one space, even when the label overruns the column. */
  const field = (label: string, value: string): void =>
    write(`    ${label.length >= LABEL_WIDTH ? `${label} ` : label.padEnd(LABEL_WIDTH)}${value}`);
  /** Continuation lines line up under the value column. */
  const fieldWrapped = (label: string, parts: string[], width = 88): void => {
    const lines: string[] = [];

    for (const part of parts) {
      if (lines.length > 0 && `${lines[lines.length - 1]}  ${part}`.length <= width - LABEL_WIDTH - 4) {
        lines[lines.length - 1] = `${lines[lines.length - 1]}  ${part}`;
      } else {
        lines.push(part);
      }
    }

    lines.forEach((line, index) => field(index === 0 ? label : "", line));
  };

  write("=".repeat(78));
  write("PAYPAL SWEEP CANDIDATES — read-only report");
  write(
    `statuses: ${options.statuses.join(", ")} · window: last ${options.days}d · ` +
      `min age: ${options.minAgeMinutes}m · app_name: ${APP_NAME}`,
  );
  write(`generated: ${new Date().toISOString()}`);
  write("=".repeat(78));

  if (snapshot.missingTables.length > 0) {
    write();
    write(`! tables not present in this database: ${snapshot.missingTables.join(", ")}`);
  }

  write();
  write("-".repeat(78));
  write(`${candidates.length} candidate(s)`);
  write("-".repeat(78));

  if (candidates.length === 0) {
    write("  none");
  }

  candidates.forEach((candidate, index) => {
    const { row } = candidate;
    const currency = currencyOf(candidate);
    const billing = candidate.checkout?.billingAddress;
    const location = [billing?.city, billing?.countryArea, billing?.postalCode, billing?.country?.code]
      .filter(Boolean)
      .join(", ");
    const name = customerName(candidate.checkout);
    const email = customerEmail(candidate);

    write();
    write(`  [${index + 1}] ${row.status.toUpperCase()} · ${money(row.amount, currency)} · ${candidate.verdict}`);
    field(
      "Customer",
      name === "—" && email === "—" ? "— no customer details readable in Saleor —" : `${name} <${email}>`,
    );
    if (billing?.phone) field("Phone", billing.phone);
    if (location) field("Billing location", location);
    field(
      "Captured",
      `${money(row.amount, currency)} at ${row.created_at} (${humanAge(minutesSince(row.created_at))})`,
    );
    field("Payment method", paymentMethod(candidate));

    if (candidate.checkout) {
      field(
        "Checkout total",
        `${money(candidate.checkout.totalPrice?.gross?.amount, currency)} · ` +
          `balance ${money(candidate.checkout.totalBalance?.amount, currency)} · ` +
          `authorize=${candidate.checkout.authorizeStatus ?? "?"} charge=${candidate.checkout.chargeStatus ?? "?"}`,
      );
      field(
        "Checkout",
        `${row.checkout_id} · created ${candidate.checkout.created ?? "?"} · ` +
          `${candidate.checkout.lines.length} line(s), ${candidate.checkout.lines.reduce(
            (total, line) => total + line.quantity,
            0,
          )} item(s)`,
      );
      if (candidate.checkout.channel?.slug) field("Channel", candidate.checkout.channel.slug);
      const items = candidate.checkout.lines
        .filter((line) => line.variant)
        .map((line) => `${line.quantity}× ${line.variant?.sku ?? line.variant?.name ?? "?"}`)
        .join(", ");

      if (items) field("Items", items);
    } else {
      field("Checkout", `${row.checkout_id} — NOT READABLE IN SALEOR`);
    }

    if (candidate.transaction) {
      field(
        "Saleor amounts",
        `charged ${money(candidate.transaction.chargedAmount?.amount, currency)} · ` +
          `authorized ${money(candidate.transaction.authorizedAmount?.amount, currency)} · ` +
          `refunded ${money(candidate.transaction.refundedAmount?.amount, currency)}`,
      );
      const events = candidate.transaction.events
        .map((event) => `${event.type ?? "?"}@${event.createdAt}`)
        .join(" → ");

      if (events) field("Events", events);
    }

    field(
      "Saleor order",
      candidate.transaction?.order
        ? `#${candidate.transaction.order.number} (${candidate.transaction.order.status}, ` +
            `total ${money(candidate.transaction.order.total?.gross?.amount, currency)}, ` +
            `balance ${money(candidate.transaction.order.totalBalance?.amount, currency)})`
        : "— none — (this is why it is a candidate)",
    );

    fieldWrapped(
      "Trace",
      traceRefs(candidate).map(([label, value]) => `${label}=${value}`),
    );

    field("Sweep state", `attempts=${row.attempts} · last checked ${row.last_checked_at ?? "never"}`);
    field("Tenant", row.tenant);
    if (row.note) field("Row note", row.note);
    field("Assessment", candidate.reason);
    if (candidate.saleorErrors.length > 0) {
      field("Lookup warnings", candidate.saleorErrors.join(" | "));
    }
  });

  if (options.includeLocks && snapshot.leakedLocks.length > 0) {
    write();
    write("-".repeat(78));
    write(`LEAKED PAYMENT LOCKS — ${snapshot.leakedLocks.length} row(s) older than 5m`);
    write("-".repeat(78));
    write("  payment_attempt_lock rows are deleted in a finally block, so anything here");
    write("  means a process died mid-payment. The table is shared with the Authorize.Net");
    write("  app, so a row may belong to either gateway. Not itself proof of a lost order.");
    for (const lock of snapshot.leakedLocks) {
      write(
        `  ${lock.checkout_id}  locked ${humanAge(lock.ageMinutes)}` +
          `${lock.hasReconciliationRow ? "  (has a candidate row above)" : "  (no candidate row here)"}`,
      );
    }
  }

  const byVerdict = new Map<Verdict, number>();

  for (const candidate of candidates) {
    byVerdict.set(candidate.verdict, (byVerdict.get(candidate.verdict) ?? 0) + 1);
  }

  /*
   * Totalled per currency, never summed across them. The reconciliation table
   * stores no currency column, so anything we could not confirm from Saleor is
   * bucketed as unknown rather than silently folded into the largest currency.
   */
  const atRisk = candidates.filter((candidate) => candidate.verdict !== "ORDER_ALREADY_EXISTS");
  const atRiskByCurrency = new Map<string, number>();

  for (const candidate of atRisk) {
    const key = currencyOf(candidate) ?? "currency unconfirmed";

    atRiskByCurrency.set(key, (atRiskByCurrency.get(key) ?? 0) + Number(candidate.row.amount || 0));
  }

  write();
  write("=".repeat(78));
  write(`SUMMARY — ${candidates.length} candidate(s)`);
  for (const [verdict, count] of [...byVerdict].sort((a, b) => b[1] - a[1])) {
    write(`  ${String(count).padStart(4)}  ${verdict}`);
  }
  write(`  money not yet tied to an order (${atRisk.length} row(s)):`);
  if (atRiskByCurrency.size === 0) {
    write(`        none`);
  }
  for (const [currency, total] of [...atRiskByCurrency].sort((a, b) => b[1] - a[1])) {
    write(`        ${total.toFixed(2)} ${currency}`);
  }
  write();
  write(
    ACTIONABLE.some((verdict) => byVerdict.has(verdict))
      ? "Rows marked NEEDS_MANUAL_REVIEW / CHECKOUT_GONE will NOT be retried by the sweep —\nsomeone has to create the order or refund the customer."
      : "Nothing here needs a human yet; the sweep will keep working these rows.",
  );
  write("Authorize.Net candidates are reported separately by that app's own script.");
  write("This report changed nothing.");
  write("=".repeat(78));

  return out.join("\n");
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value);

  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function renderCsv(candidates: Candidate[]): string {
  const columns = [
    "gateway",
    "verdict",
    "status",
    "row_id",
    "tenant",
    "captured_at",
    "age_minutes",
    "amount",
    "currency",
    "customer_name",
    "customer_email",
    "customer_phone",
    "checkout_total",
    "checkout_created",
    "channel",
    "payment_method",
    "saleor_transaction_id",
    "psp_reference",
    "paypal_order_id",
    "saleor_channel_id",
    "order_number",
    "order_status",
    "attempts",
    "last_checked_at",
    "checkout_id",
    "authorize_status",
    "charge_status",
    "note",
    "assessment",
  ];

  const lines = [columns.join(",")];

  for (const candidate of candidates) {
    const { row } = candidate;
    const refs = new Map(traceRefs(candidate));

    lines.push(
      [
        GATEWAY,
        candidate.verdict,
        row.status,
        row.id,
        row.tenant,
        row.created_at,
        Math.round(minutesSince(row.created_at)),
        row.amount,
        currencyOf(candidate),
        customerName(candidate.checkout),
        customerEmail(candidate),
        candidate.checkout?.billingAddress?.phone,
        candidate.checkout?.totalPrice?.gross?.amount?.toFixed(2),
        candidate.checkout?.created,
        candidate.checkout?.channel?.slug,
        paymentMethod(candidate),
        row.transaction_id,
        refs.get("saleor.pspReference"),
        row.paypal_order_id,
        row.channel_id,
        candidate.transaction?.order?.number,
        candidate.transaction?.order?.status,
        row.attempts,
        row.last_checked_at,
        row.checkout_id,
        candidate.checkout?.authorizeStatus,
        candidate.checkout?.chargeStatus,
        row.note,
        candidate.reason,
      ]
        .map(csvCell)
        .join(","),
    );
  }

  return lines.join("\n");
}

function renderJson(candidates: Candidate[], snapshot: DbSnapshot, options: Options): string {
  return JSON.stringify(
    {
      gateway: GATEWAY,
      generatedAt: new Date().toISOString(),
      readOnly: true,
      options,
      missingTables: snapshot.missingTables,
      leakedLocks: options.includeLocks ? snapshot.leakedLocks : undefined,
      candidates: candidates.map((candidate) => ({
        verdict: candidate.verdict,
        assessment: candidate.reason,
        tenant: candidate.row.tenant,
        customer: {
          name: customerName(candidate.checkout),
          email: customerEmail(candidate),
          phone: candidate.checkout?.billingAddress?.phone ?? null,
        },
        amount: {
          captured: candidate.row.amount,
          currency: currencyOf(candidate),
          checkoutTotal: candidate.checkout?.totalPrice?.gross?.amount ?? null,
          checkoutBalance: candidate.checkout?.totalBalance?.amount ?? null,
        },
        dates: {
          capturedAt: candidate.row.created_at,
          checkoutCreated: candidate.checkout?.created ?? null,
          lastCheckedAt: candidate.row.last_checked_at,
        },
        paymentMethod: paymentMethod(candidate),
        trace: Object.fromEntries(traceRefs(candidate)),
        order: candidate.transaction?.order ?? null,
        sweepState: {
          status: candidate.row.status,
          attempts: candidate.row.attempts,
          note: candidate.row.note,
        },
        checkout: candidate.checkout,
        transaction: candidate.transaction,
        lookupWarnings: candidate.saleorErrors,
      })),
    },
    null,
    2,
  );
}

// ---------------------------------------------------------------- main

async function main(): Promise<void> {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    process.stdout.write(`${HELP}\n`);

    return;
  }

  const options = parseOptions(process.argv.slice(2));
  const pool = createPool();

  try {
    note(`Reading ${RECONCILIATION_TABLE}...`);
    const snapshot = await readDatabase(pool, options);

    note(`Found ${snapshot.rows.length} row(s) matching the filters.`);

    if (snapshot.tokensByTenant.size === 0) {
      note(
        `  [warn] no active APL rows for app_name="${APP_NAME}". ` +
          `app_names present: ${snapshot.knownAppNames.join(", ") || "none"}. ` +
          `Override with SWEEP_APP_NAME.`,
      );
    }

    let candidates: Candidate[];

    if (!options.enrichFromSaleor) {
      candidates = snapshot.rows.map((row) => {
        const { verdict, reason } = decide(row, { transaction: null, checkout: null }, "skipped");

        return { row, transaction: null, checkout: null, saleorErrors: [], verdict, reason };
      });
    } else {
      note(`Enriching from Saleor (${snapshot.rows.length} lookup pair(s))...`);
      candidates = await mapWithConcurrency(snapshot.rows, 5, async (row) => {
        const token = snapshot.tokensByTenant.get(row.tenant);

        if (!token) {
          const { verdict, reason } = decide(row, { transaction: null, checkout: null }, "no-token");

          return {
            row,
            transaction: null,
            checkout: null,
            saleorErrors: [`no stored Saleor token for tenant ${row.tenant} / app "${APP_NAME}"`],
            verdict,
            reason,
          };
        }

        const { transaction, checkout, errors } = await enrich(row, token);
        const { verdict, reason } = decide(row, { transaction, checkout }, "done");

        return { row, transaction, checkout, saleorErrors: errors, verdict, reason };
      });
    }

    // Most urgent first, then most recent — the order someone should work them in.
    const urgency: Verdict[] = [
      "CHECKOUT_GONE",
      "NEEDS_MANUAL_REVIEW",
      "NEEDS_SWEEP",
      "UNKNOWN",
      "ORDER_ALREADY_EXISTS",
    ];

    candidates.sort(
      (a, b) =>
        urgency.indexOf(a.verdict) - urgency.indexOf(b.verdict) ||
        new Date(b.row.created_at).getTime() - new Date(a.row.created_at).getTime(),
    );

    const report =
      options.format === "json"
        ? renderJson(candidates, snapshot, options)
        : options.format === "csv"
          ? renderCsv(candidates)
          : renderText(candidates, snapshot, options);

    process.stdout.write(`${report}\n`);

    if (options.failOnFindings && candidates.some((candidate) => ACTIONABLE.includes(candidate.verdict))) {
      process.exitCode = 1;
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  note(`Report failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
  process.exit(1);
});
