import { err, ok, Result } from "neverthrow";

import {
  AppIsNotConfiguredResponse,
  BrokenAppResponse,
  MalformedRequestResponse,
} from "@/app/api/webhooks/saleor/saleor-webhook-responses";
import { TransactionProcessSessionEventFragment } from "@/generated/graphql";
import { appContextContainer } from "@/lib/app-context";
import { getPool } from "@/lib/database";
import { BaseError } from "@/lib/errors";
import { createGraphQLClient } from "@/lib/graphql-client";
import { createLogger } from "@/lib/logger";
import {
  formatDeclineMessage,
  interpretCaptureResponse,
} from "@/modules/paypal/capture-result";
import { PayPalConfigRepo } from "@/modules/paypal/configuration/paypal-config-repo";
import {
  mapPayPalErrorToApiError,
  PayPalApiError,
} from "@/modules/paypal/paypal-api-error";
import { createPayPalOrderId } from "@/modules/paypal/paypal-order-id";
import { IPayPalOrdersApiFactory } from "@/modules/paypal/types";
import { assertNotAlreadyPaid } from "@/modules/reconciliation/checkout-balance";
import { hasUnresolvedPaymentAttempt, messageForAttemptCheck } from "@/modules/reconciliation/cross-gateway-guard";
import { withPaymentLock } from "@/modules/reconciliation/payment-attempt-lock";
import { resolveSynchronously, savePendingReconciliation, startReconciliationSweep } from "@/modules/reconciliation/reconciliation";
import { resolveSaleorMoneyFromPayPalOrder } from "@/modules/saleor/resolve-saleor-money-from-paypal-order";
import { SaleorApiUrl } from "@/modules/saleor/saleor-api-url";
import {
  AuthorizationFailureResult,
  ChargeFailureResult,
} from "@/modules/transaction-result/failure-result";
import { ChargeSuccessResult } from "@/modules/transaction-result/success-result";
import { GlobalPayPalConfigRepository } from "@/modules/wsm-admin/global-paypal-config-repository";

import {
  TransactionProcessSessionUseCaseResponses,
  TransactionProcessSessionUseCaseResponsesType,
} from "./use-case-response";

startReconciliationSweep();

type UseCaseExecuteResult = Result<
  TransactionProcessSessionUseCaseResponsesType,
  AppIsNotConfiguredResponse | BrokenAppResponse | MalformedRequestResponse
>;

export class TransactionProcessSessionUseCase {
  private logger = createLogger("TransactionProcessSessionUseCase");
  private paypalConfigRepo: PayPalConfigRepo;
  private paypalOrdersApiFactory: IPayPalOrdersApiFactory;

  constructor(deps: {
    paypalConfigRepo: PayPalConfigRepo;
    paypalOrdersApiFactory: IPayPalOrdersApiFactory;
  }) {
    this.paypalConfigRepo = deps.paypalConfigRepo;
    this.paypalOrdersApiFactory = deps.paypalOrdersApiFactory;
  }

  async execute(args: {
    authData: import("@saleor/app-sdk/APL").AuthData;
    event: TransactionProcessSessionEventFragment;
  }): Promise<UseCaseExecuteResult> {
    const { authData, event } = args;

    this.logger.info("Processing transaction process session event", {
      transactionId: event.transaction.pspReference,
      actionType: event.action.actionType,
      amount: event.action.amount,
    });

    // Get channel ID from the event
    const channelId = event.sourceObject.channel.id;

    // Get PayPal configuration for this channel
    const paypalConfigResult = await this.paypalConfigRepo.getPayPalConfig(authData, channelId);

    if (paypalConfigResult.isErr()) {
      this.logger.error("Failed to get PayPal configuration", {
        error: paypalConfigResult.error,
      });

      return err(
        new BrokenAppResponse(
          appContextContainer.getContextValue(),
          paypalConfigResult.error,
        ),
      );
    }

    if (!paypalConfigResult.value) {
      this.logger.warn("PayPal configuration not found for channel", {
        channelId,
      });

      return err(
        new AppIsNotConfiguredResponse(
          appContextContainer.getContextValue(),
          new BaseError("PayPal configuration not found for channel"),
        ),
      );
    }

    const config = paypalConfigResult.value;

    // Set app context early so it's available even if errors occur later
    const paypalEnv = config.environment;

    this.logger.debug("Setting app context", { paypalEnv });
    appContextContainer.set({
      paypalEnv,
    });

    // Verify context was set
    const contextCheck = appContextContainer.getContextValue();

    this.logger.debug("App context after set", {
      paypalEnv: contextCheck.paypalEnv,
    });

    // Fetch BN code from global config for partner attribution
    let bnCode: string | undefined;

    try {
      const pool = getPool();
      const globalConfigRepository = GlobalPayPalConfigRepository.create(pool);
      const { resolveTenantEnvironment } = await import("@/modules/wsm-admin/resolve-tenant-environment");
      const tenantEnv = await resolveTenantEnvironment(authData.saleorApiUrl, pool);
      const globalConfigResult = await globalConfigRepository.getConfigByEnvironment(tenantEnv);

      if (globalConfigResult.isOk() && globalConfigResult.value) {
        bnCode = globalConfigResult.value.bnCode || undefined;
        this.logger.debug("Retrieved BN code from global config", {
          hasBnCode: !!bnCode,
        });
      } else {
        this.logger.warn("No active global config found for BN code", {
          error: globalConfigResult.isErr() ? globalConfigResult.error : undefined,
        });
      }
    } catch (error) {
      this.logger.warn("Failed to fetch BN code from global config", {
        error,
      });
    }

    // Create PayPal orders API instance with merchant context
    const paypalOrdersApi = this.paypalOrdersApiFactory.create({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      merchantId: config.merchantId ? (config.merchantId as any) : undefined,
      merchantEmail: config.merchantEmail || undefined,
      bnCode,
      env: config.environment,
    });

    // Get PayPal order ID from transaction pspReference
    const paypalOrderId = createPayPalOrderId(event.transaction.pspReference);

    this.logger.debug("Processing PayPal order", {
      paypalOrderId,
      actionType: event.action.actionType,
    });

    /*
     * Double-payment guard (order #60 class of bug): refuse outright if
     * this checkout/order is already paid elsewhere (cross-gateway — reads
     * Saleor's own aggregate balance), and serialize concurrent attempts
     * on the same checkout (e.g. two tabs) via a shared short-lived lock.
     */
    const balanceCheckSourceId = event.sourceObject.id;
    const balanceCheckIsOrder = event.sourceObject.__typename === "Order";
    const graphQLClient = createGraphQLClient(authData.saleorApiUrl, authData.token);

    /*
     * Closes the async-reconciliation-window gap: a prior ambiguous charge
     * (on either gateway) not yet reported to Saleor won't show up in
     * totalBalance below, but it's still real money — refuse rather than
     * let a second one through while it's unresolved.
     */
    const attemptCheck = await hasUnresolvedPaymentAttempt(balanceCheckSourceId);

    if (attemptCheck.blocked) {
      if (attemptCheck.reason === "query_error") {
        this.logger.warn(
          "Blocked capture attempt: cross-gateway reconciliation guard couldn't complete its lookup, failing closed (see the lookup-failed error for the real cause).",
          { checkoutId: balanceCheckSourceId },
        );
      }
      const failureResult =
        event.action.actionType === "CHARGE"
          ? new ChargeFailureResult()
          : new AuthorizationFailureResult();

      return ok(
        new TransactionProcessSessionUseCaseResponses.Failure({
          transactionResult: failureResult,
          error: new PayPalApiError(messageForAttemptCheck(attemptCheck), { paypalErrorName: "RECONCILIATION_PENDING" }),
          paypalOrderId,
          appContext: appContextContainer.getContextValue(),
        }),
      );
    }

    const balanceCheck = await assertNotAlreadyPaid(
      graphQLClient,
      balanceCheckSourceId,
      balanceCheckIsOrder,
      Number(event.action.amount),
    );

    if (!balanceCheck.allowed) {
      const failureResult =
        event.action.actionType === "CHARGE"
          ? new ChargeFailureResult()
          : new AuthorizationFailureResult();

      return ok(
        new TransactionProcessSessionUseCaseResponses.Failure({
          transactionResult: failureResult,
          error: new PayPalApiError(balanceCheck.message, { paypalErrorName: "OVERCHARGE_BLOCKED" }),
          paypalOrderId,
          appContext: appContextContainer.getContextValue(),
        }),
      );
    }

    // Based on action type, either capture or authorize the order
    const processResult = await withPaymentLock(
      balanceCheckSourceId,
      () =>
        event.action.actionType === "CHARGE"
          ? paypalOrdersApi.captureOrder({ orderId: paypalOrderId })
          : paypalOrdersApi.authorizeOrder({ orderId: paypalOrderId }),
      () => err({ code: "PAYMENT_LOCK_BUSY" as const }),
    );

    if (processResult.isErr()) {
      const isLockBusy =
        !!processResult.error &&
        typeof processResult.error === "object" &&
        (processResult.error as { code?: string }).code === "PAYMENT_LOCK_BUSY";

      const error = isLockBusy
        ? new PayPalApiError("Another payment attempt is already being processed for this order.", {
            paypalErrorName: "PAYMENT_LOCK_BUSY",
          })
        : mapPayPalErrorToApiError(processResult.error);

      this.logger.error("Failed to process PayPal order", {
        error,
        paypalOrderId,
        actionType: event.action.actionType,
      });

      const failureResult = event.action.actionType === "CHARGE"
        ? new ChargeFailureResult()
        : new AuthorizationFailureResult();

      return ok(
        new TransactionProcessSessionUseCaseResponses.Failure({
          transactionResult: failureResult,
          error,
          paypalOrderId,
          appContext: appContextContainer.getContextValue(),
        }),
      );
    }

    const paypalOrder = processResult.value;

    /*
     * PayPal returned HTTP 2xx, but a 2xx capture response can still
     * carry a DECLINED capture. order.status alone is not enough.
     */
    const outcome = interpretCaptureResponse(paypalOrder);

    this.logger.info("Capture response received", {
      paypalOrderId,
      orderStatus: paypalOrder.status,
      captureOutcome: outcome.kind,
      actionType: event.action.actionType,
    });

    if (outcome.kind === "declined") {
      this.logger.warn("PayPal capture declined", {
        paypalOrderId,
        captureId: outcome.captureId,
        captureStatus: outcome.captureStatus,
        reasonCode: outcome.reasonCode,
        avsCode: outcome.avsCode,
        cvvCode: outcome.cvvCode,
      });

      const failureResult =
        event.action.actionType === "CHARGE"
          ? new ChargeFailureResult()
          : new AuthorizationFailureResult();

      return ok(
        new TransactionProcessSessionUseCaseResponses.Failure({
          transactionResult: failureResult,
          error: new PayPalApiError(formatDeclineMessage(outcome), {
            paypalErrorName: "CAPTURE_DECLINED",
            paypalErrorMessage: outcome.captureStatus,
          }),
          paypalOrderId,
          appContext: appContextContainer.getContextValue(),
        }),
      );
    }

    if (outcome.kind === "missing") {
      this.logger.error("Capture response missing capture object", {
        paypalOrderId,
        orderStatus: outcome.orderStatus,
      });

      const failureResult =
        event.action.actionType === "CHARGE"
          ? new ChargeFailureResult()
          : new AuthorizationFailureResult();

      return ok(
        new TransactionProcessSessionUseCaseResponses.Failure({
          transactionResult: failureResult,
          error: new PayPalApiError("No capture in PayPal response", {
            paypalErrorName: "CAPTURE_MISSING",
          }),
          paypalOrderId,
          appContext: appContextContainer.getContextValue(),
        }),
      );
    }

    /*
     * outcome.kind is "succeeded" or "pending" past this point.
     * PENDING captures are rare for cards but legitimate (e.g. risk review).
     * Saleor's CHARGE_SUCCESS still fits — the funds are committed; if PayPal
     * subsequently fails them, the webhook-driven reconciliation handles it.
     * If a separate CHARGE_REQUEST result is added later, branch here.
     */

    /*
     * WSM6-1373: PayPal has genuinely captured this payment — save a
     * reconciliation row *right now*, before anything else below gets a
     * chance to throw or fail and lose the order despite the real charge.
     */
    if (event.sourceObject.__typename === "Checkout") {
      await savePendingReconciliation({
        tenant: authData.saleorApiUrl,
        checkoutId: event.sourceObject.id,
        transactionId: event.transaction.id,
        channelId,
        paypalOrderId,
        amount: Number(event.action.amount),
      });
    }

    // Log vault info if present (for debugging vaulting issues)
    const vaultInfo = paypalOrder.payment_source?.card?.attributes?.vault;

    if (vaultInfo) {
      this.logger.info("Card vaulting result from capture", {
        vaultId: vaultInfo.id,
        vaultStatus: vaultInfo.status,
        customerId: vaultInfo.customer?.id,
      });
    } else {
      this.logger.debug("No vault info in capture response", {
        hasPaymentSource: !!paypalOrder.payment_source,
        hasCard: !!paypalOrder.payment_source?.card,
        hasAttributes: !!paypalOrder.payment_source?.card?.attributes,
      });
    }

    // Resolve Saleor money from PayPal order
    const saleorMoneyResult = resolveSaleorMoneyFromPayPalOrder(paypalOrder);

    if (saleorMoneyResult.isErr()) {
      this.logger.error("Failed to resolve Saleor money from PayPal order", {
        error: saleorMoneyResult.error,
      });

      return err(
        new BrokenAppResponse(
          appContextContainer.getContextValue(),
          saleorMoneyResult.error,
        ),
      );
    }

    const successResult = new ChargeSuccessResult();

    /*
     * We're about to report this charge to Saleor ourselves, synchronously —
     * the pending row saved above is no longer needed to recover anything.
     * Resolve it now so the sweep/webhook fast-track never re-reports the
     * same charge under a different pspReference and doubles charged_value.
     */
    if (event.sourceObject.__typename === "Checkout") {
      await resolveSynchronously(authData.saleorApiUrl, paypalOrderId);
    }

    return ok(
      new TransactionProcessSessionUseCaseResponses.Success({
        transactionResult: successResult,
        saleorMoney: saleorMoneyResult.value,
        paypalOrderId,
        appContext: appContextContainer.getContextValue(),
      }),
    );
  }
}