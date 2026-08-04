import { Result, ResultAsync } from "neverthrow";

import { createLogger } from "@/lib/logger";

import { PayPalClient } from "./paypal-client";
import { PayPalClientId } from "./paypal-client-id";
import { PayPalClientSecret } from "./paypal-client-secret";
import { PayPalEnv } from "./paypal-env";
import { PayPalMerchantId } from "./paypal-merchant-id";

const logger = createLogger("PayPalReportingApi");

/**
 * Read-only wrapper over PayPal's Transaction Search API
 * (`GET /v1/reporting/transactions`).
 *
 * Why this exists: every other PayPal call in this app is keyed by an order id
 * we already know about. That cannot answer "what did PayPal actually approve
 * that we have no record of" — a capture that succeeded while the app crashed
 * before writing its reconciliation row leaves nothing local to look up. This
 * endpoint enumerates the merchant's transactions for a date range, which is the
 * only gateway-first view available.
 *
 * Three operational constraints, all imposed by PayPal:
 *   - The app's REST credentials must have the Transaction Search feature
 *     enabled. Without it the call fails with an authorization error rather than
 *     returning an empty list, which is why the caller must surface the error
 *     instead of reading it as "nothing found".
 *   - A single request may not span more than 31 days.
 *   - Transactions can take up to ~3 hours to appear, so a window ending "now"
 *     will under-report very recent captures. Audit with a lag.
 */
export const MAX_TRANSACTION_SEARCH_DAYS = 31;

/** PayPal's own page-size ceiling for this endpoint. */
const PAGE_SIZE = 500;

/**
 * `transaction_status` values worth auditing. "S" (success) is the one that
 * means money moved; "P" (pending) is included because a pending capture is
 * still money the customer believes they have paid.
 */
const APPROVED_STATUSES = new Set(["S", "P"]);

export interface PayPalReportedTransaction {
  /** Capture/payment id — NOT the order id. */
  transactionId: string;
  /** "S" success, "P" pending, "D" denied, "V" void. */
  status: string;
  /** e.g. "T0006" (express checkout payment), "T1107" (refund). */
  eventCode: string | null;
  initiationDate: string | null;
  updatedDate: string | null;
  amountValue: number | null;
  amountCurrency: string | null;
  /** PayPal's own cross-reference, usually the order id for a capture. */
  referenceId: string | null;
  invoiceId: string | null;
  /**
   * Raw `custom_field`, which this app sets to a JSON blob of Saleor ids when
   * creating the order (see the `metadata` argument threaded into
   * `purchase_units[].custom_id` by PayPalOrdersApi#createOrder).
   */
  customField: string | null;
  payerEmail: string | null;
  payerName: string | null;
  payerId: string | null;
}

interface RawTransactionInfo {
  transaction_id?: string;
  transaction_status?: string;
  transaction_event_code?: string;
  transaction_initiation_date?: string;
  transaction_updated_date?: string;
  transaction_amount?: { value?: string; currency_code?: string };
  paypal_reference_id?: string;
  invoice_id?: string;
  custom_field?: string;
}

interface RawPayerInfo {
  account_id?: string;
  email_address?: string;
  payer_name?: { alternate_full_name?: string; given_name?: string; surname?: string };
}

interface TransactionSearchResponse {
  transaction_details?: Array<{ transaction_info?: RawTransactionInfo; payer_info?: RawPayerInfo }>;
  total_items?: number;
  total_pages?: number;
  page?: number;
}

/**
 * Saleor ids this app stamps onto every PayPal order it creates. Recovering
 * them from `custom_field` is what lets an audit tie a gateway-side capture back
 * to a specific Saleor transaction without any local record at all.
 */
export interface SaleorRefsFromCustomField {
  saleorTransactionId: string | null;
  saleorSourceId: string | null;
  saleorSourceType: string | null;
  saleorChannelId: string | null;
}

export function parseSaleorRefs(customField: string | null): SaleorRefsFromCustomField | null {
  if (!customField) return null;

  try {
    const parsed = JSON.parse(customField) as Record<string, unknown>;
    const asString = (key: string): string | null =>
      typeof parsed[key] === "string" ? (parsed[key] as string) : null;

    const refs = {
      saleorTransactionId: asString("saleor_transaction_id"),
      saleorSourceId: asString("saleor_source_id"),
      saleorSourceType: asString("saleor_source_type"),
      saleorChannelId: asString("saleor_channel_id"),
    };

    /*
     * A custom_field set by something other than this app parses fine as JSON
     * but carries none of our keys — treat that as "not ours".
     */
    return refs.saleorTransactionId || refs.saleorSourceId ? refs : null;
  } catch {
    return null;
  }
}

function toReported(detail: {
  transaction_info?: RawTransactionInfo;
  payer_info?: RawPayerInfo;
}): PayPalReportedTransaction {
  const info = detail.transaction_info ?? {};
  const payer = detail.payer_info ?? {};
  const rawAmount = info.transaction_amount?.value;
  const name = payer.payer_name;
  // `.trim()` on an all-empty name yields "", not null, so normalise explicitly.
  const composedName =
    name?.alternate_full_name?.trim() ||
    [name?.given_name, name?.surname].filter(Boolean).join(" ").trim() ||
    null;

  return {
    transactionId: info.transaction_id ?? "",
    status: info.transaction_status ?? "unknown",
    eventCode: info.transaction_event_code ?? null,
    initiationDate: info.transaction_initiation_date ?? null,
    updatedDate: info.transaction_updated_date ?? null,
    amountValue: rawAmount === undefined ? null : Number(rawAmount),
    amountCurrency: info.transaction_amount?.currency_code ?? null,
    referenceId: info.paypal_reference_id ?? null,
    invoiceId: info.invoice_id ?? null,
    customField: info.custom_field ?? null,
    payerEmail: payer.email_address ?? null,
    payerName: composedName,
    payerId: payer.account_id ?? null,
  };
}

export class PayPalReportingApi {
  private client: PayPalClient;

  private constructor(client: PayPalClient) {
    this.client = client;
  }

  static create(args: {
    clientId: PayPalClientId;
    clientSecret: PayPalClientSecret;
    partnerMerchantId?: string | null;
    merchantId?: PayPalMerchantId | null;
    merchantEmail?: string | null;
    bnCode?: string | null;
    env: PayPalEnv;
  }): PayPalReportingApi {
    return new PayPalReportingApi(PayPalClient.create(args));
  }

  /**
   * One page of the merchant's transactions. `page` is 1-based. Dates must be
   * RFC 3339 with an offset — PayPal rejects a bare ISO date.
   */
  private searchPage(args: {
    startDate: Date;
    endDate: Date;
    page: number;
  }): Promise<TransactionSearchResponse> {
    const params = new URLSearchParams({
      start_date: args.startDate.toISOString(),
      end_date: args.endDate.toISOString(),
      fields: "transaction_info,payer_info",
      page_size: String(PAGE_SIZE),
      page: String(args.page),
    });

    return this.client.makeRequest<TransactionSearchResponse>({
      method: "GET",
      path: `/v1/reporting/transactions?${params.toString()}`,
    });
  }

  /**
   * Every transaction in the window, paged to the end and chunked to respect
   * PayPal's 31-day-per-request limit.
   *
   * A failure on any page or chunk fails the whole call rather than returning a
   * partial window — a partial audit that looks complete is worse than no audit.
   */
  async listTransactions(args: {
    startDate: Date;
    endDate: Date;
  }): Promise<Result<PayPalReportedTransaction[], unknown>> {
    return ResultAsync.fromPromise(
      (async () => {
        const collected: PayPalReportedTransaction[] = [];
        const chunkMs = MAX_TRANSACTION_SEARCH_DAYS * 24 * 60 * 60 * 1000;

        for (
          let chunkStart = args.startDate.getTime();
          chunkStart < args.endDate.getTime();
          chunkStart += chunkMs
        ) {
          const chunkEnd = new Date(Math.min(chunkStart + chunkMs, args.endDate.getTime()));

          for (let page = 1; ; page += 1) {
            const response = await this.searchPage({
              startDate: new Date(chunkStart),
              endDate: chunkEnd,
              page,
            });

            const details = response.transaction_details ?? [];

            collected.push(...details.map(toReported));

            const totalPages = response.total_pages ?? 1;

            if (page >= totalPages || details.length === 0) break;
          }
        }

        logger.info("PayPal transaction search complete", {
          from: args.startDate.toISOString(),
          to: args.endDate.toISOString(),
          count: collected.length,
        });

        return collected;
      })(),
      (error) => error,
    );
  }

  /**
   * The subset where money moved (or is about to) — the population an audit for
   * untracked payments cares about. Refunds and other non-payment events are
   * filtered out by event code.
   */
  async listApprovedPayments(args: {
    startDate: Date;
    endDate: Date;
  }): Promise<Result<PayPalReportedTransaction[], unknown>> {
    const result = await this.listTransactions(args);

    return result.map((transactions) =>
      transactions.filter(
        (transaction) =>
          APPROVED_STATUSES.has(transaction.status) &&
          // T00xx is the payment family; T11xx refunds, T03xx withdrawals etc.
          (transaction.eventCode === null || transaction.eventCode.startsWith("T00")),
      ),
    );
  }
}
