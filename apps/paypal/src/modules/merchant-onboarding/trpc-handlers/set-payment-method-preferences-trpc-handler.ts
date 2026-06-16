import { captureException } from "@sentry/nextjs";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { getPool } from "@/lib/database";
import { createSaleorApiUrl } from "@/modules/saleor/saleor-api-url";
import { protectedClientProcedure } from "@/modules/trpc/protected-client-procedure";

import { PostgresMerchantOnboardingRepository } from "../merchant-onboarding-repository";
import {
  findDisallowedEnabledMethods,
  PAYMENT_METHOD_LABELS,
  resolveEffectivePaymentMethods,
} from "../payment-method-preferences";

/**
 * tRPC Handler for setting a merchant's payment method preferences (enable/disable).
 *
 * Guard: a method may only be enabled if PayPal allows it for this merchant
 * (capability/readiness is true). Attempting to enable a disallowed method is rejected.
 */
export class SetPaymentMethodPreferencesTrpcHandler {
  baseProcedure = protectedClientProcedure;

  getTrpcProcedure() {
    return this.baseProcedure
      .input(
        z.object({
          // `undefined` leaves a method's preference unchanged.
          paypalButtons: z.boolean().optional(),
          card: z.boolean().optional(),
          applePay: z.boolean().optional(),
          googlePay: z.boolean().optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        if (!ctx.saleorApiUrl) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Missing saleorApiUrl in request",
          });
        }

        const saleorApiUrl = createSaleorApiUrl(ctx.saleorApiUrl);

        if (saleorApiUrl.isErr()) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Malformed saleorApiUrl",
          });
        }

        try {
          const pool = getPool();
          const repository = PostgresMerchantOnboardingRepository.create(pool);

          const existingResult = await repository.getBySaleorApiUrl(saleorApiUrl.value);

          if (existingResult.isErr()) {
            captureException(existingResult.error);
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Failed to retrieve merchant record",
            });
          }

          if (!existingResult.value) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Merchant onboarding record not found",
            });
          }

          const record = existingResult.value;

          // Guard: reject enabling any method PayPal does not allow for this merchant.
          const disallowed = findDisallowedEnabledMethods(input, {
            paypalButtons: record.paypalButtonsEnabled,
            card: record.acdcEnabled,
            applePay: record.applePayEnabled,
            googlePay: record.googlePayEnabled,
          });

          if (disallowed.length > 0) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `Cannot enable payment method(s) not allowed by PayPal for this merchant: ${disallowed
                .map((method) => PAYMENT_METHOD_LABELS[method])
                .join(", ")}`,
            });
          }

          const updateResult = await repository.updatePaymentMethodPreferences(
            saleorApiUrl.value,
            record.trackingId,
            {
              paypalButtons: input.paypalButtons,
              card: input.card,
              applePay: input.applePay,
              googlePay: input.googlePay,
            }
          );

          if (updateResult.isErr()) {
            captureException(updateResult.error);
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Failed to update payment method preferences",
            });
          }

          const updated = updateResult.value;

          // Return the effective state so the UI reflects capability AND preference.
          const effective = resolveEffectivePaymentMethods(
            {
              paypalButtons: updated.paypalButtonsEnabled,
              advancedCardProcessing: updated.acdcEnabled,
              applePay: updated.applePayEnabled,
              googlePay: updated.googlePayEnabled,
            },
            {
              prefPaypalButtons: updated.prefPaypalButtons,
              prefCard: updated.prefCard,
              prefApplePay: updated.prefApplePay,
              prefGooglePay: updated.prefGooglePay,
            }
          );

          return {
            success: true,
            paymentMethodPreferences: effective,
          };
        } catch (error) {
          if (error instanceof TRPCError) {
            throw error;
          }

          captureException(error);
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "An unexpected error occurred",
          });
        }
      });
  }
}
