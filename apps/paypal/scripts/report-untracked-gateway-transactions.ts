#!/usr/bin/env tsx
/**
 * Read-only, gateway-first audit: approved PayPal payments that this app has no
 * record of.
 *
 * WHY THIS EXISTS ALONGSIDE report-sweep-candidates.ts: that script is app-first
 * — it lists rows in `paypal_reconciliation`, which only get written when the
 * app saw an *ambiguous* capture. If the app crashed before that insert, or the
 * capture succeeded outright and only the order-creation step failed, or the
 * storefront never called back at all, there is no local row to find and the
 * sweep report comes back empty while the money has genuinely moved. Asking
 * PayPal what it actually captured, then subtracting what we can account for, is
 * the only way to see that money.
 *
 * The join key is `custom_field`: PayPalOrdersApi#createOrder stamps
 * `purchase_units[].custom_id` with the Saleor transaction id, source (checkout
 * or order) id, source type and channel id. The Transaction Search API returns
 * that field back, so a capture can be tied to its Saleor transaction even when
 * nothing was ever written locally — see `parseSaleorRefs`.
 *
 * READ-ONLY, THREE WAYS:
 *   - Postgres: everything runs inside `BEGIN TRANSACTION READ ONLY`, so a
 *     stray write is rejected by the database rather than by code review.
 *   - Saleor: only `query` documents, never a mutation.
 *   - PayPal: only `GET /v1/reporting/transactions`. Nothing here creates,
 *     captures, authorizes, voids or refunds an order.
 *
 * PERMISSIONS / CREDENTIALS:
 *   - Reads each tenant's PayPal credentials through the app's own config repo,
 *     so SECRET_KEY must match the deployment's.
 *   - The PayPal REST app needs the Transaction Search feature enabled. Without
 *     it the call fails with an authorization error, which is reported as an
 *     error rather than as "nothing found".
 *   - Saleor confirmation uses `transaction(id:)`, covered by HANDLE_PAYMENTS.
 *
 * TWO CAVEATS WORTH READING BEFORE ACTING ON OUTPUT:
 *   - PayPal can take ~3 hours to surface a transaction in this API, so a window
 *     ending "now" under-reports very recent captures. Audit with a lag, or
 *     re-run before concluding a recent payment is missing.
 *   - The endpoint returns everything the merchant account took, including
 *     payments from other systems (the legacy platform, a different storefront).
 *     Those legitimately have no record here. Read UNKNOWN_TO_APP as "this app
 *     cannot account for it", not automatically as "lost order".
 *
 * Usage (env loaded from .env, same as `pnpm migrate:database`):
 *   pnpm report:untracked-transactions
 *   pnpm report:untracked-transactions -- --days=7
 *   pnpm report:untracked-transactions -- --from=2026-07-01 --to=2026-07-31
 *   pnpm report:untracked-transactions -- --format=csv > untracked.csv
 *   pnpm report:untracked-transactions -- --only-untracked
 *
 * Requires DB_* env vars plus SECRET_KEY.
 *
 * cspell:words regclass
 */
/*
 * Type-only imports here, with the real modules pulled in dynamically inside
 * main(). src/lib/env.ts validates the environment (SECRET_KEY and friends) at
 * module-load time and throws, so a static import would make even `--help` and
 * argument validation fail on a machine without credentials configured.
 */
import type { Pool } from "pg";

import type {
  PayPalReportedTransaction,
  SaleorRefsFromCustomField,
} from "../src/modules/paypal/paypal-reporting-api";

// ---------------------------------------------------------------- CLI

interface Options {
  from: Date;
  to: Date;
  format: "text" | "json" | "csv";
  onlyUntracked: boolean;
  failOnFindings: boolean;
}

const HELP = `
Read-only audit of approved PayPal payments this app cannot account for.

  --days=<n>                 Look back n days from now (default: 30)
  --from=<YYYY-MM-DD>        Explicit window start (overrides --days)
  --to=<YYYY-MM-DD>          Explicit window end (default: now)
  --format=<text|json|csv>   Output format (default: text)
  --only-untracked           Omit payments the app can fully account for
  --fail-on-findings         Exit 1 if anything is untracked or orderless
  --help                     Show this

Calls only PayPal's Transaction Search API; no order is created, captured,
voided or refunded, and nothing is written to Postgres or Saleor.

Note: PayPal can take ~3 hours to surface a transaction in this API, so very
recent captures may be missing from a window that ends now.
`;

function parseOptions(argv: string[]): Options {
  const value = (name: string): string | undefined => {
    const hit = argv.find((arg) => arg.startsWith(`--${name}=`));

    return hit ? hit.slice(name.length + 3) : undefined;
  };

  const format = value("format") ?? "text";

  if (!["text", "json", "csv"].includes(format)) {
    throw new Error(`--format must be one of: text, json, csv`);
  }

  const parseDate = (raw: string, label: string): Date => {
    const parsed = new Date(raw);

    if (Number.isNaN(parsed.getTime())) throw new Error(`--${label} is not a valid date: ${raw}`);

    return parsed;
  };

  const toRaw = value("to");
  const to = toRaw ? parseDate(toRaw, "to") : new Date();
  const daysRaw = value("days");
  const days = daysRaw === undefined ? 30 : Number(daysRaw);

  if (!Number.isFinite(days) || days <= 0) throw new Error("--days must be a positive number");

  const fromRaw = value("from");
  const from = fromRaw
    ? parseDate(fromRaw, "from")
    : new Date(to.getTime() - days * 24 * 60 * 60 * 1000);

  if (from >= to) throw new Error("--from must be earlier than --to");

  return {
    from,
    to,
    format: format as Options["format"],
    onlyUntracked: argv.includes("--only-untracked"),
    failOnFindings: argv.includes("--fail-on-findings"),
  };
}

// ---------------------------------------------------------------- shapes

/**
 * How much of a gateway payment this app can account for. Ordered from worst to
 * most benign — see `URGENCY`.
 */
type Verdict =
  | "UNKNOWN_TO_APP"
  | "CAPTURED_NO_ORDER"
  | "RECONCILIATION_PENDING"
  | "TRACKED_WITH_ORDER"
  | "UNVERIFIABLE";

interface Finding {
  tenant: string;
  gateway: PayPalReportedTransaction;
  saleorRefs: SaleorRefsFromCustomField | null;
  reconciliation: { id: string; status: string; note: string | null } | null;
  saleorOrder: { number: string; status: string } | null;
  saleorErrors: string[];
  verdict: Verdict;
  reason: string;
}

const URGENCY: Verdict[] = [
  "UNKNOWN_TO_APP",
  "CAPTURED_NO_ORDER",
  "RECONCILIATION_PENDING",
  "UNVERIFIABLE",
  "TRACKED_WITH_ORDER",
];

/** Verdicts that mean money may have moved without an order behind it. */
const ACTIONABLE: Verdict[] = ["UNKNOWN_TO_APP", "CAPTURED_NO_ORDER"];

// ---------------------------------------------------------------- utils

const note = (message: string): void => {
  process.stderr.write(`${message}\n`);
};

const money = (amount: number | null, currency: string | null): string =>
  amount === null || !Number.isFinite(amount) ? "—" : `${amount.toFixed(2)} ${currency ?? "?"}`;

// ---------------------------------------------------------------- app-side records

interface LocalRecords {
  /** Keyed by paypal_order_id. */
  byPaypalOrderId: Map<string, { id: string; status: string; note: string | null }>;
  /** Keyed by the Saleor TransactionItem id the row was created for. */
  bySaleorTransactionId: Map<string, { id: string; status: string; note: string | null }>;
  missingTable: boolean;
}

/**
 * Every reconciliation row this app holds for one tenant, read in a single
 * read-only transaction. `to_regclass` is used rather than catching "relation
 * does not exist", because a failed statement would abort the transaction and
 * every later statement would fail with 25P02.
 */
async function readLocalRecords(pool: Pool, tenant: string): Promise<LocalRecords> {
  const client = await pool.connect();
  const byPaypalOrderId = new Map<string, { id: string; status: string; note: string | null }>();
  const bySaleorTransactionId = new Map<string, { id: string; status: string; note: string | null }>();
  let missingTable = false;

  try {
    await client.query("BEGIN TRANSACTION READ ONLY");

    const { rows: present } = await client.query(
      `SELECT to_regclass('paypal_reconciliation') IS NOT NULL AS present`,
    );

    if (present[0]?.present === true) {
      const { rows } = await client.query(
        `SELECT id::text, status, note, paypal_order_id, transaction_id
           FROM paypal_reconciliation
          WHERE tenant = $1`,
        [tenant],
      );

      for (const row of rows) {
        const entry = { id: row.id, status: row.status, note: row.note ?? null };

        if (row.paypal_order_id) byPaypalOrderId.set(row.paypal_order_id, entry);
        if (row.transaction_id) bySaleorTransactionId.set(row.transaction_id, entry);
      }
    } else {
      missingTable = true;
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  return { byPaypalOrderId, bySaleorTransactionId, missingTable };
}

// ---------------------------------------------------------------- saleor

const TRANSACTION_ORDER_QUERY = `query UntrackedTransactionOrder($id: ID!) {
  transaction(id: $id) {
    order { number status }
  }
}`;

async function fetchSaleorOrder(
  saleorApiUrl: string,
  token: string,
  saleorTransactionId: string,
): Promise<{ order: { number: string; status: string } | null; errors: string[] }> {
  try {
    const response = await fetch(saleorApiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ query: TRANSACTION_ORDER_QUERY, variables: { id: saleorTransactionId } }),
    });

    if (!response.ok) {
      return { order: null, errors: [`HTTP ${response.status} ${response.statusText}`] };
    }

    const body = (await response.json()) as {
      data?: { transaction?: { order?: { number: string; status: string } | null } | null };
      errors?: Array<{ message: string }>;
    };

    return {
      order: body.data?.transaction?.order ?? null,
      errors: (body.errors ?? []).map((error) => error.message),
    };
  } catch (error) {
    return { order: null, errors: [error instanceof Error ? error.message : String(error)] };
  }
}

// ---------------------------------------------------------------- verdict

function decide(finding: Omit<Finding, "verdict" | "reason">): { verdict: Verdict; reason: string } {
  const { saleorRefs, reconciliation, saleorOrder, gateway } = finding;

  if (saleorOrder) {
    return {
      verdict: "TRACKED_WITH_ORDER",
      reason: `Accounted for — Saleor order #${saleorOrder.number} (${saleorOrder.status}).`,
    };
  }

  if (reconciliation && ["pending", "needs_review"].includes(reconciliation.status)) {
    return {
      verdict: "RECONCILIATION_PENDING",
      reason: `Already known: reconciliation row ${reconciliation.id} is "${reconciliation.status}" — it will show up in report-sweep-candidates.ts too.`,
    };
  }

  if (saleorRefs?.saleorTransactionId) {
    return {
      verdict: "CAPTURED_NO_ORDER",
      reason: `PayPal captured this against Saleor transaction ${saleorRefs.saleorTransactionId}, but that transaction has no order — the money moved and the order was never created.`,
    };
  }

  if (saleorRefs?.saleorSourceId) {
    return {
      verdict: "UNVERIFIABLE",
      reason: `Created by this app (source ${saleorRefs.saleorSourceId}) but no Saleor transaction id was stamped on it, so no order can be confirmed either way. Check that checkout by hand.`,
    };
  }

  return {
    verdict: "UNKNOWN_TO_APP",
    reason: `No Saleor ids in custom_field and no reconciliation row for capture ${gateway.transactionId}. Either this app took it and lost the record, or it was taken by another system on the same merchant account (legacy platform, other storefront).`,
  };
}

// ---------------------------------------------------------------- rendering

function renderText(findings: Finding[], options: Options, warnings: string[]): string {
  const out: string[] = [];
  const write = (line = ""): void => void out.push(line);
  const field = (label: string, value: string): void => write(`    ${label.padEnd(19)}${value}`);

  write("=".repeat(78));
  write("PAYPAL PAYMENTS NOT TRACKED BY THIS APP — read-only report");
  write(`window: ${options.from.toISOString()} → ${options.to.toISOString()}`);
  write(`generated: ${new Date().toISOString()}`);
  write("=".repeat(78));

  for (const warning of warnings) {
    write(`! ${warning}`);
  }

  const shown = options.onlyUntracked
    ? findings.filter((finding) => finding.verdict !== "TRACKED_WITH_ORDER")
    : findings;

  write();
  write("-".repeat(78));
  write(`${shown.length} payment(s)${options.onlyUntracked ? " (tracked ones hidden)" : ""}`);
  write("-".repeat(78));

  if (shown.length === 0) {
    write("  none");
  }

  shown.forEach((finding, index) => {
    const { gateway } = finding;

    write();
    write(
      `  [${index + 1}] ${finding.verdict} · ${money(gateway.amountValue, gateway.amountCurrency)} · ` +
        `status=${gateway.status}${gateway.eventCode ? ` event=${gateway.eventCode}` : ""}`,
    );
    field("Payer", `${gateway.payerName ?? "—"} <${gateway.payerEmail ?? "—"}>`);
    field("Initiated", gateway.initiationDate ?? "—");
    field("paypal.captureId", gateway.transactionId);
    if (gateway.referenceId) field("paypal.referenceId", gateway.referenceId);
    if (gateway.invoiceId) field("paypal.invoiceId", gateway.invoiceId);
    field(
      "Saleor ids stamped",
      finding.saleorRefs
        ? [
            finding.saleorRefs.saleorTransactionId
              ? `transaction=${finding.saleorRefs.saleorTransactionId}`
              : null,
            finding.saleorRefs.saleorSourceId
              ? `${finding.saleorRefs.saleorSourceType ?? "source"}=${finding.saleorRefs.saleorSourceId}`
              : null,
            finding.saleorRefs.saleorChannelId ? `channel=${finding.saleorRefs.saleorChannelId}` : null,
          ]
            .filter(Boolean)
            .join(" · ")
        : "— none (custom_field absent or not written by this app) —",
    );
    field(
      "Reconciliation",
      finding.reconciliation
        ? `row ${finding.reconciliation.id} · ${finding.reconciliation.status}`
        : "— no row —",
    );
    field(
      "Saleor order",
      finding.saleorOrder ? `#${finding.saleorOrder.number} (${finding.saleorOrder.status})` : "— none —",
    );
    field("Tenant", finding.tenant);
    field("Assessment", finding.reason);
    if (finding.saleorErrors.length > 0) field("Lookup warnings", finding.saleorErrors.join(" | "));
  });

  const byVerdict = new Map<Verdict, number>();

  for (const finding of findings) {
    byVerdict.set(finding.verdict, (byVerdict.get(finding.verdict) ?? 0) + 1);
  }

  // Totalled per currency, never summed across them.
  const unaccounted = findings.filter((finding) => ACTIONABLE.includes(finding.verdict));
  const totals = new Map<string, number>();

  for (const finding of unaccounted) {
    const key = finding.gateway.amountCurrency ?? "currency unknown";

    totals.set(key, (totals.get(key) ?? 0) + (finding.gateway.amountValue ?? 0));
  }

  write();
  write("=".repeat(78));
  write(`SUMMARY — ${findings.length} approved PayPal payment(s) in window`);
  for (const verdict of URGENCY) {
    const count = byVerdict.get(verdict);

    if (count) write(`  ${String(count).padStart(4)}  ${verdict}`);
  }
  write(`  money this app cannot tie to an order (${unaccounted.length} payment(s)):`);
  if (totals.size === 0) write(`        none`);
  for (const [currency, total] of [...totals].sort((a, b) => b[1] - a[1])) {
    write(`        ${total.toFixed(2)} ${currency}`);
  }
  write();
  write("PayPal can take ~3 hours to surface a transaction here, so a very recent capture");
  write("may be missing. UNKNOWN_TO_APP can also be a payment from another system on the");
  write("same merchant account — check before treating one as a lost order.");
  write("This report changed nothing.");
  write("=".repeat(78));

  return out.join("\n");
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value);

  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function renderCsv(findings: Finding[]): string {
  const columns = [
    "verdict",
    "tenant",
    "paypal_capture_id",
    "paypal_reference_id",
    "initiated",
    "gateway_status",
    "event_code",
    "amount",
    "currency",
    "payer_name",
    "payer_email",
    "saleor_transaction_id",
    "saleor_source_id",
    "saleor_source_type",
    "reconciliation_id",
    "reconciliation_status",
    "order_number",
    "order_status",
    "assessment",
  ];

  const lines = [columns.join(",")];

  for (const finding of findings) {
    const { gateway } = finding;

    lines.push(
      [
        finding.verdict,
        finding.tenant,
        gateway.transactionId,
        gateway.referenceId,
        gateway.initiationDate,
        gateway.status,
        gateway.eventCode,
        gateway.amountValue?.toFixed(2),
        gateway.amountCurrency,
        gateway.payerName,
        gateway.payerEmail,
        finding.saleorRefs?.saleorTransactionId,
        finding.saleorRefs?.saleorSourceId,
        finding.saleorRefs?.saleorSourceType,
        finding.reconciliation?.id,
        finding.reconciliation?.status,
        finding.saleorOrder?.number,
        finding.saleorOrder?.status,
        finding.reason,
      ]
        .map(csvCell)
        .join(","),
    );
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------- main

async function main(): Promise<void> {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    process.stdout.write(`${HELP}\n`);

    return;
  }

  const options = parseOptions(process.argv.slice(2));
  const warnings: string[] = [];
  const findings: Finding[] = [];

  // Deferred so --help and bad arguments don't require a configured env.
  const [{ getPool }, { saleorApp }, { paypalConfigRepo }, reporting] = await Promise.all([
    import("../src/lib/database"),
    import("../src/lib/saleor-app"),
    import("../src/modules/paypal/configuration/paypal-config-repo"),
    import("../src/modules/paypal/paypal-reporting-api"),
  ]);
  const { PayPalReportingApi, parseSaleorRefs } = reporting;

  note(`Auditing ${options.from.toISOString()} → ${options.to.toISOString()}`);

  const tenants = await saleorApp.apl.getAll();

  note(`Found ${tenants.length} installed tenant(s).`);

  for (const authData of tenants) {
    note(`--- ${authData.saleorApiUrl}`);

    const configResult = await paypalConfigRepo.getPayPalConfig(authData);

    if (configResult.isErr()) {
      warnings.push(
        `${authData.saleorApiUrl}: could not read PayPal config (SECRET_KEY mismatch?): ${configResult.error.message}`,
      );
      continue;
    }

    const config = configResult.value;

    if (!config) {
      warnings.push(`${authData.saleorApiUrl}: no PayPal config stored — skipped.`);
      continue;
    }

    const reportingApi = PayPalReportingApi.create({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      merchantId: config.merchantId ? (config.merchantId as never) : undefined,
      merchantEmail: config.merchantEmail || undefined,
      env: config.environment,
    });

    const approved = await reportingApi.listApprovedPayments({
      startDate: options.from,
      endDate: options.to,
    });

    if (approved.isErr()) {
      warnings.push(
        `${authData.saleorApiUrl}: PayPal transaction search failed — if this is an authorization error, the REST app needs the Transaction Search feature enabled: ${String(
          approved.error,
        )}`,
      );
      continue;
    }

    note(`    ${approved.value.length} approved payment(s) at the gateway`);

    const local = await readLocalRecords(getPool(), authData.saleorApiUrl);

    if (local.missingTable) {
      warnings.push(
        `${authData.saleorApiUrl}: table paypal_reconciliation does not exist — treated as no records.`,
      );
    }

    for (const gateway of approved.value) {
      const saleorRefs = parseSaleorRefs(gateway.customField);

      const reconciliation =
        (gateway.referenceId ? local.byPaypalOrderId.get(gateway.referenceId) : undefined) ??
        (saleorRefs?.saleorTransactionId
          ? local.bySaleorTransactionId.get(saleorRefs.saleorTransactionId)
          : undefined) ??
        null;

      let saleorOrder: { number: string; status: string } | null = null;
      let saleorErrors: string[] = [];

      if (saleorRefs?.saleorTransactionId) {
        const result = await fetchSaleorOrder(
          authData.saleorApiUrl,
          authData.token,
          saleorRefs.saleorTransactionId,
        );

        saleorOrder = result.order;
        saleorErrors = result.errors;
      }

      const partial = {
        tenant: authData.saleorApiUrl,
        gateway,
        saleorRefs,
        reconciliation,
        saleorOrder,
        saleorErrors,
      };

      findings.push({ ...partial, ...decide(partial) });
    }
  }

  findings.sort(
    (a, b) =>
      URGENCY.indexOf(a.verdict) - URGENCY.indexOf(b.verdict) ||
      (b.gateway.amountValue ?? 0) - (a.gateway.amountValue ?? 0),
  );

  const visible = options.onlyUntracked
    ? findings.filter((finding) => finding.verdict !== "TRACKED_WITH_ORDER")
    : findings;

  const report =
    options.format === "json"
      ? JSON.stringify(
          {
            gateway: "paypal",
            generatedAt: new Date().toISOString(),
            readOnly: true,
            window: { from: options.from.toISOString(), to: options.to.toISOString() },
            warnings,
            findings: visible,
          },
          null,
          2,
        )
      : options.format === "csv"
        ? renderCsv(visible)
        : renderText(findings, options, warnings);

  process.stdout.write(`${report}\n`);

  if (options.failOnFindings && findings.some((finding) => ACTIONABLE.includes(finding.verdict))) {
    process.exitCode = 1;
  }

  await getPool().end();
}

main().catch((error) => {
  note(`Audit failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
  process.exit(1);
});
