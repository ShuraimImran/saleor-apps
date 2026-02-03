import { createLogger } from "@/lib/logger";

import { PayPalClient } from "./paypal-client";
import { PayPalClientId } from "./paypal-client-id";
import { PayPalClientSecret } from "./paypal-client-secret";
import { getPayPalApiUrl,PayPalEnv } from "./paypal-env";

const logger = createLogger("PayPalWebhookVerification");

/**
 * PayPal Webhook Signature Verification
 *
 * Verifies that a webhook request actually came from PayPal by calling
 * PayPal's verify-webhook-signature API endpoint.
 *
 * @see https://developer.paypal.com/api/rest/webhooks/rest/#verify-webhook-signature
 */
export interface WebhookHeaders {
  "paypal-transmission-id": string;
  "paypal-transmission-time": string;
  "paypal-transmission-sig": string;
  "paypal-cert-url": string;
  "paypal-auth-algo": string;
}

export interface WebhookVerificationParams {
  webhookId: string;
  headers: WebhookHeaders;
  body: any;
  clientId: PayPalClientId;
  clientSecret: PayPalClientSecret;
  env: PayPalEnv;
}

export interface WebhookVerificationResult {
  verified: boolean;
  verificationStatus: string;
}

/**
 * Verifies webhook signature using PayPal's API
 *
 * This method calls PayPal's /v1/notifications/verify-webhook-signature endpoint
 * which is the recommended approach for webhook verification.
 *
 * @returns Object containing verification result
 */
export async function verifyWebhookSignature(
  params: WebhookVerificationParams
): Promise<WebhookVerificationResult> {
  const { webhookId, headers, body, clientId, clientSecret, env } = params;

  logger.info("Verifying webhook signature via PayPal API", {
    webhookId,
    transmissionId: headers["paypal-transmission-id"],
    transmissionTime: headers["paypal-transmission-time"],
    authAlgo: headers["paypal-auth-algo"],
  });

  // Check for required headers
  const missingHeaders: string[] = [];

  if (!headers["paypal-transmission-id"]) missingHeaders.push("paypal-transmission-id");
  if (!headers["paypal-transmission-time"]) missingHeaders.push("paypal-transmission-time");
  if (!headers["paypal-transmission-sig"]) missingHeaders.push("paypal-transmission-sig");
  if (!headers["paypal-cert-url"]) missingHeaders.push("paypal-cert-url");
  if (!headers["paypal-auth-algo"]) missingHeaders.push("paypal-auth-algo");

  if (missingHeaders.length > 0) {
    logger.warn("Missing required PayPal webhook headers", {
      missingHeaders,
      webhookId,
    });

    return {
      verified: false,
      verificationStatus: `MISSING_HEADERS: ${missingHeaders.join(", ")}`,
    };
  }

  try {
    // Get access token
    const baseUrl = getPayPalApiUrl(env);
    const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

    const tokenResponse = await fetch(`${baseUrl}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${auth}`,
      },
      body: "grant_type=client_credentials",
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();

      logger.error("Failed to get access token for webhook verification", {
        status: tokenResponse.status,
        error: errorText,
      });

      return {
        verified: false,
        verificationStatus: "AUTH_FAILED",
      };
    }

    const tokenData = (await tokenResponse.json()) as { access_token: string };

    // Call verify-webhook-signature endpoint
    const verifyPayload = {
      auth_algo: headers["paypal-auth-algo"],
      cert_url: headers["paypal-cert-url"],
      transmission_id: headers["paypal-transmission-id"],
      transmission_sig: headers["paypal-transmission-sig"],
      transmission_time: headers["paypal-transmission-time"],
      webhook_id: webhookId,
      webhook_event: body,
    };

    const verifyResponse = await fetch(`${baseUrl}/v1/notifications/verify-webhook-signature`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokenData.access_token}`,
      },
      body: JSON.stringify(verifyPayload),
    });

    if (!verifyResponse.ok) {
      const errorText = await verifyResponse.text();

      logger.error("PayPal webhook signature verification API call failed", {
        status: verifyResponse.status,
        error: errorText,
        webhookId,
      });

      return {
        verified: false,
        verificationStatus: `API_ERROR: ${verifyResponse.status}`,
      };
    }

    const verifyResult = (await verifyResponse.json()) as {
      verification_status: "SUCCESS" | "FAILURE";
    };

    logger.info("Webhook signature verification result", {
      webhookId,
      verificationStatus: verifyResult.verification_status,
      transmissionId: headers["paypal-transmission-id"],
    });

    return {
      verified: verifyResult.verification_status === "SUCCESS",
      verificationStatus: verifyResult.verification_status,
    };
  } catch (error) {
    logger.error("Exception during webhook signature verification", {
      error: error instanceof Error ? error.message : String(error),
      webhookId,
    });

    return {
      verified: false,
      verificationStatus: `EXCEPTION: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Extract webhook verification headers from a request
 */
export function extractWebhookHeaders(request: Request): WebhookHeaders | null {
  const transmissionId = request.headers.get("paypal-transmission-id");
  const transmissionTime = request.headers.get("paypal-transmission-time");
  const transmissionSig = request.headers.get("paypal-transmission-sig");
  const certUrl = request.headers.get("paypal-cert-url");
  const authAlgo = request.headers.get("paypal-auth-algo");

  // If any required header is missing, return null
  if (!transmissionId || !transmissionTime || !transmissionSig || !certUrl || !authAlgo) {
    return null;
  }

  return {
    "paypal-transmission-id": transmissionId,
    "paypal-transmission-time": transmissionTime,
    "paypal-transmission-sig": transmissionSig,
    "paypal-cert-url": certUrl,
    "paypal-auth-algo": authAlgo,
  };
}
