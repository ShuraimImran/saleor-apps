import { withSpanAttributesAppRouter } from "@saleor/apps-otel/src/with-span-attributes";
import { compose } from "@saleor/apps-shared/compose";
import { captureException } from "@sentry/nextjs";

import {
  MalformedRequestResponse,
  UnhandledErrorResponse,
} from "@/app/api/webhooks/saleor/saleor-webhook-responses";
import { appContextContainer } from "@/lib/app-context";
import { BaseError } from "@/lib/errors";
import { getCachedIdempotentResponse, storeIdempotentResponse } from "@/lib/idempotency";
import { createLogger } from "@/lib/logger";
import { withLoggerContext } from "@/lib/logger-context";
import { paypalConfigRepo } from "@/modules/paypal/configuration/paypal-config-repo";
import { PayPalOrdersApiFactory } from "@/modules/paypal/paypal-orders-api-factory";
import { createSaleorApiUrl } from "@/modules/saleor/saleor-api-url";

import { TransactionProcessSessionUseCase } from "./use-case";
import { transactionProcessSessionWebhookDefinition } from "./webhook-definition";

const useCase = new TransactionProcessSessionUseCase({
  paypalConfigRepo,
  paypalOrdersApiFactory: new PayPalOrdersApiFactory(),
});

const logger = createLogger("TRANSACTION_PROCESS_SESSION route");

const handler = transactionProcessSessionWebhookDefinition.createHandler(async (_req: any, ctx: any) => {
  try {
    logger.info("Received transaction process session webhook request");

    const saleorApiUrlResult = createSaleorApiUrl(ctx.authData.saleorApiUrl);

    if (saleorApiUrlResult.isErr()) {
      captureException(saleorApiUrlResult.error);
      const response = new MalformedRequestResponse(
        appContextContainer.getContextValue(),
        saleorApiUrlResult.error,
      );

      return response.getResponse();
    }

    /*
     * TRANSACTION_PROCESS_SESSION has no idempotencyKey field of its own
     * (unlike TRANSACTION_INITIALIZE_SESSION) — derive a stable key from
     * the transaction being processed. A genuine Saleor retry of the same
     * action targets the same transaction with the same actionType/amount.
     */
    const idempotencyKey = `${ctx.payload.transaction.id}:${ctx.payload.action.actionType}:${ctx.payload.action.amount}`;

    const cached = (await getCachedIdempotentResponse(ctx.authData.saleorApiUrl, idempotencyKey)) as
      | { status: number; body: unknown }
      | null;

    if (cached) {
      logger.info("Returning cached response for retried transaction process session webhook", {
        idempotencyKey,
      });

      return Response.json(cached.body, { status: cached.status });
    }

    const result = await useCase.execute({
      authData: ctx.authData,
      event: ctx.payload,
    });

    return result.match(
      async (result) => {
        logger.info("Successfully processed transaction process session webhook request", {
          result: result.transactionResult.result,
        });

        try {
          const appContext = appContextContainer.getContextValue();

          logger.info("About to generate response", {
            hasPaypalEnv: !!appContext.paypalEnv,
            paypalEnv: appContext.paypalEnv,
          });

          const response = result.getResponse();

          try {
            const body = await response.clone().json();

            await storeIdempotentResponse(ctx.authData.saleorApiUrl, idempotencyKey, {
              status: response.status,
              body,
            });
          } catch (cacheError) {
            logger.error("Failed to cache idempotent response", { error: cacheError });
          }

          return response;
        } catch (error: unknown) {
          logger.error("Error generating response", {
            error,
            errorMessage: error instanceof Error ? error.message : String(error),
            errorName: error instanceof Error ? error.name : typeof error,
          });
          throw error;
        }
      },
      async (error) => {
        if (error instanceof BaseError) {
          captureException(error);
        }

        logger.error("Failed to process transaction process session webhook request", {
          error: error.message,
        });

        return error.getResponse();
      },
    );
  } catch (error) {
    captureException(error);
    logger.error("Unhandled error in transaction process session webhook", {
      error,
      errorMessage: error instanceof Error ? error.message : String(error),
      errorName: error instanceof Error ? error.name : typeof error,
      errorStack: error instanceof Error ? error.stack : undefined,
    });

    const unhandledErrorResponse = new UnhandledErrorResponse(
      appContextContainer.getContextValue(),
      error instanceof Error ? error : new Error(String(error)),
    );

    return unhandledErrorResponse.getResponse();
  }
});

export const POST = compose(
  appContextContainer.wrapRequest,
  withLoggerContext,
  withSpanAttributesAppRouter
)(handler);