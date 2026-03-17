import { NextRequest, NextResponse } from "next/server";

import { getPool } from "@/lib/database";
import { createLogger } from "@/lib/logger";
import { createPayPalMerchantId } from "@/modules/paypal/paypal-merchant-id";

const logger = createLogger("PayPalCallbackAPI");

/**
 * Public API endpoint for PayPal onboarding callback
 *
 * Called by the /paypal-callback page after merchant completes PayPal onboarding.
 * Updates the merchant record with the PayPal merchant ID directly in the database,
 * bypassing the need for localStorage (which doesn't work cross-tab in iframes
 * due to Chrome's storage partitioning).
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { trackingId, merchantIdInPayPal } = body;

    if (!trackingId || !merchantIdInPayPal) {
      return NextResponse.json(
        { error: "Missing required fields: trackingId and merchantIdInPayPal" },
        { status: 400 }
      );
    }

    logger.info("Processing PayPal onboarding callback", {
      trackingId,
      merchantIdInPayPal,
    });

    const pool = getPool();

    // Look up the onboarding record by trackingId
    const lookupResult = await pool.query(
      `SELECT id, saleor_api_url, onboarding_status, paypal_merchant_id
       FROM paypal_merchant_onboarding
       WHERE tracking_id = $1
       LIMIT 1`,
      [trackingId]
    );

    if (lookupResult.rows.length === 0) {
      logger.warn("No onboarding record found for tracking ID", { trackingId });

      return NextResponse.json(
        { error: "Onboarding record not found" },
        { status: 404 }
      );
    }

    const record = lookupResult.rows[0];

    // Skip if already updated
    if (record.paypal_merchant_id) {
      logger.info("Merchant ID already set, skipping update", {
        trackingId,
        existingMerchantId: record.paypal_merchant_id,
      });

      return NextResponse.json({ success: true, message: "Already updated" });
    }

    // Validate and create branded merchant ID
    const merchantId = createPayPalMerchantId(merchantIdInPayPal);

    // Update the record
    await pool.query(
      `UPDATE paypal_merchant_onboarding
       SET paypal_merchant_id = $1,
           onboarding_status = 'IN_PROGRESS',
           onboarding_started_at = COALESCE(onboarding_started_at, NOW()),
           updated_at = NOW()
       WHERE tracking_id = $2`,
      [merchantId, trackingId]
    );

    logger.info("Merchant ID updated via callback", {
      trackingId,
      merchantIdInPayPal,
      saleorApiUrl: record.saleor_api_url,
    });

    return NextResponse.json({ success: true, message: "Merchant ID updated" });
  } catch (error) {
    logger.error("Failed to process PayPal callback", {
      error: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
