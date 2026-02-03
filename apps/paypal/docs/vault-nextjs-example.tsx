/**
 * Vault Without Purchase — Next.js Reference Implementation
 *
 * This is a REFERENCE file showing how to integrate the PayPal JS SDK v6
 * vault-without-purchase flow into a Next.js storefront.
 *
 * It mirrors the working vault-sdk-v6.html test page.
 *
 * Prerequisites:
 * - Buyer is authenticated (you have their Saleor JWT from `tokenCreate`)
 * - PayPal Payment App is running and configured
 * - Advanced Vaulting is enabled on the PayPal merchant account
 *
 * Usage:
 * - Copy and adapt this into your storefront's "My Payment Methods" page
 * - Replace PAYMENT_APP_URL and SALEOR_API_URL with your values
 * - Pass the buyer's JWT token from your auth context
 */

"use client";

import Script from "next/script";
import { useCallback, useEffect, useRef, useState } from "react";

/*
 * ---------------------------------------------------------------------------
 * Configuration — replace with your environment values or pull from env vars
 * ---------------------------------------------------------------------------
 */
const PAYMENT_APP_URL = process.env.NEXT_PUBLIC_PAYMENT_APP_URL!; // e.g. "https://your-paypal-app.vercel.app"
const SALEOR_API_URL = process.env.NEXT_PUBLIC_SALEOR_API_URL!; // e.g. "https://your-store.saleor.cloud/graphql/"

/*
 * ---------------------------------------------------------------------------
 * Types
 * ---------------------------------------------------------------------------
 */
interface SavedCard {
  id: string;
  type: string;
  card: {
    brand: string;
    lastDigits: string;
    expiry?: string;
  };
}

interface SetupTokenResponse {
  setupTokenId: string;
  status: string;
  approvalUrl: string | null;
  customerId: string;
  paymentMethodType: string;
}

interface PaymentTokenResponse {
  paymentTokenId: string;
  customerId: string;
  paymentMethodType: string;
  card: {
    brand: string;
    lastDigits: string;
    expiry: string;
  } | null;
}

/*
 * ---------------------------------------------------------------------------
 * tRPC helpers (plain fetch — no @trpc/client dependency needed)
 * ---------------------------------------------------------------------------
 */
async function trpcQuery<T>(
  procedure: string,
  input: Record<string, unknown>,
  token: string,
): Promise<T> {
  const encodedInput = encodeURIComponent(JSON.stringify(input));
  const url = `${PAYMENT_APP_URL}/api/trpc/${procedure}?input=${encodedInput}`;

  const res = await fetch(url, {
    method: "GET",
    headers: {
      "saleor-api-url": SALEOR_API_URL,
      "authorization-bearer": token,
    },
  });

  const data = await res.json();

  if (data.error) {
    const msg =
      data.error?.json?.message || data.error?.message || JSON.stringify(data.error);

    throw new Error(msg);
  }

  return (data.result?.data ?? data) as T;
}

async function trpcMutation<T>(
  procedure: string,
  input: Record<string, unknown>,
  token: string,
): Promise<T> {
  const url = `${PAYMENT_APP_URL}/api/trpc/${procedure}`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "saleor-api-url": SALEOR_API_URL,
      "authorization-bearer": token,
    },
    body: JSON.stringify(input),
  });

  const data = await res.json();

  if (data.error) {
    const msg =
      data.error?.json?.message || data.error?.message || JSON.stringify(data.error);

    throw new Error(msg);
  }

  return (data.result?.data ?? data) as T;
}

/*
 * ---------------------------------------------------------------------------
 * PayPal SDK v6 loader
 * ---------------------------------------------------------------------------
 * The v6 SDK is loaded via <Script> tag. This helper waits for it + creates
 * an instance using the server-generated clientToken.
 */
async function createPayPalSdkInstance(clientToken: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const paypal = (window as any).paypal;

  if (!paypal?.createInstance) {
    throw new Error("PayPal SDK v6 not loaded");
  }

  return paypal.createInstance({
    clientToken,
    components: ["card-fields"],
  });
}

/*
 * ---------------------------------------------------------------------------
 * Component
 * ---------------------------------------------------------------------------
 */
export default function SavedPaymentMethodsPage({
  userToken,
}: {
  /** The buyer's Saleor JWT from `tokenCreate` */
  userToken: string;
}) {
  // --- State ---
  const [savedCards, setSavedCards] = useState<SavedCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCardForm, setShowCardForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Refs for PayPal SDK objects (not React state — they hold DOM references)
  const sdkInstanceRef = useRef<any>(null);
  const vaultSessionRef = useRef<any>(null);
  const setupTokenIdRef = useRef<string | null>(null);

  // Refs for card field containers
  const cardNumberRef = useRef<HTMLDivElement>(null);
  const cardExpiryRef = useRef<HTMLDivElement>(null);
  const cardCvvRef = useRef<HTMLDivElement>(null);

  // Track if SDK script is loaded
  const [sdkScriptLoaded, setSdkScriptLoaded] = useState(false);

  /*
   * ----------------------------------------------------------
   * Load saved cards on mount
   * ----------------------------------------------------------
   */
  const loadSavedCards = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await trpcQuery<{ savedPaymentMethods: SavedCard[] }>(
        "customerVault.listSavedPaymentMethods",
        {},
        userToken,
      );

      setSavedCards(result.savedPaymentMethods || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load saved cards");
    } finally {
      setLoading(false);
    }
  }, [userToken]);

  useEffect(() => {
    loadSavedCards();
  }, [loadSavedCards]);

  /*
   * ----------------------------------------------------------
   * Delete a saved card
   * ----------------------------------------------------------
   */
  const handleDelete = async (paymentTokenId: string) => {
    if (!confirm("Remove this card from your wallet?")) return;

    try {
      await trpcMutation(
        "customerVault.deleteSavedPaymentMethod",
        { paymentTokenId },
        userToken,
      );
      await loadSavedCards();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete card");
    }
  };

  /*
   * ----------------------------------------------------------
   * Start the "Add Card" flow
   * ----------------------------------------------------------
   */
  const handleAddCard = async () => {
    setError(null);
    setSuccessMessage(null);
    setSubmitting(true);

    try {
      // Step 1a: Create setup token
      const setupResult = await trpcMutation<SetupTokenResponse>(
        "customerVault.createSetupToken",
        {
          paymentMethodType: "card",
          verificationMethod: "SCA_WHEN_REQUIRED",
          returnUrl: window.location.href,
          cancelUrl: window.location.href,
        },
        userToken,
      );

      setupTokenIdRef.current = setupResult.setupTokenId;

      // Step 1b: Get client token for SDK v6
      const { clientToken } = await trpcQuery<{ clientToken: string }>(
        "customerVault.generateClientToken",
        {},
        userToken,
      );

      // Step 2: Initialize SDK and create vault session
      if (!sdkScriptLoaded) {
        throw new Error("PayPal SDK script not loaded yet. Please try again.");
      }

      const sdk = await createPayPalSdkInstance(clientToken);

      sdkInstanceRef.current = sdk;

      const session = sdk.createCardFieldsSavePaymentSession();

      vaultSessionRef.current = session;

      // Show card form first so refs are in the DOM
      setShowCardForm(true);

      // Wait a tick for React to render the containers
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Step 3: Render card fields as Web Components
      const numberField = session.createCardFieldsComponent({ type: "number" });
      const expiryField = session.createCardFieldsComponent({ type: "expiry" });
      const cvvField = session.createCardFieldsComponent({ type: "cvv" });

      // Clear previous children
      if (cardNumberRef.current) cardNumberRef.current.innerHTML = "";
      if (cardExpiryRef.current) cardExpiryRef.current.innerHTML = "";
      if (cardCvvRef.current) cardCvvRef.current.innerHTML = "";

      cardNumberRef.current?.appendChild(numberField);
      cardExpiryRef.current?.appendChild(expiryField);
      cardCvvRef.current?.appendChild(cvvField);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start vault flow");
      setShowCardForm(false);
    } finally {
      setSubmitting(false);
    }
  };

  /*
   * ----------------------------------------------------------
   * Submit card details
   * ----------------------------------------------------------
   */
  const handleSubmitCard = async () => {
    if (!vaultSessionRef.current || !setupTokenIdRef.current) return;

    setSubmitting(true);
    setError(null);

    try {
      // Step 4: Submit card to PayPal (v6 returns { state, data })
      const result = await vaultSessionRef.current.submit(setupTokenIdRef.current);

      switch (result.state) {
        case "succeeded": {
          // Step 5: Convert setup token → payment token
          const paymentResult = await trpcMutation<PaymentTokenResponse>(
            "customerVault.createPaymentTokenFromSetupToken",
            { setupTokenId: setupTokenIdRef.current },
            userToken,
          );

          const cardInfo = paymentResult.card
            ? `${paymentResult.card.brand} ending in ${paymentResult.card.lastDigits}`
            : "Card";

          setSuccessMessage(`${cardInfo} saved to your wallet.`);
          setShowCardForm(false);
          await loadSavedCards();
          break;
        }

        case "canceled":
          setError("Card save was canceled.");
          break;

        case "failed":
          setError(`Card validation failed: ${result.data?.message || "Unknown error"}`);
          break;

        default:
          setError(`Unexpected result: ${result.state}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Card submission failed");
    } finally {
      setSubmitting(false);
    }
  };

  /*
   * ----------------------------------------------------------
   * Cancel adding a card
   * ----------------------------------------------------------
   */
  const handleCancel = () => {
    setShowCardForm(false);
    setError(null);
    setupTokenIdRef.current = null;
    vaultSessionRef.current = null;
  };

  /*
   * ----------------------------------------------------------
   * Render
   * ----------------------------------------------------------
   */
  return (
    <div style={{ maxWidth: 480, margin: "0 auto", padding: 20 }}>
      {/* PayPal SDK v6 script — loaded once, no query params */}
      <Script
        src="https://www.sandbox.paypal.com/web-sdk/v6/core"
        strategy="afterInteractive"
        onLoad={() => setSdkScriptLoaded(true)}
      />
      {/* For production, use: https://www.paypal.com/web-sdk/v6/core */}

      <h1>My Payment Methods</h1>

      {/* ---- Status messages ---- */}
      {error && (
        <div style={{ background: "#ffebee", color: "#c62828", padding: 12, borderRadius: 8, marginBottom: 16 }}>
          {error}
        </div>
      )}
      {successMessage && (
        <div style={{ background: "#e8f5e9", color: "#2e7d32", padding: 12, borderRadius: 8, marginBottom: 16 }}>
          {successMessage}
        </div>
      )}

      {/* ---- Saved cards list ---- */}
      <section style={{ marginBottom: 24 }}>
        <h2>Saved Cards</h2>

        {loading && <p>Loading...</p>}

        {!loading && savedCards.length === 0 && (
          <p style={{ color: "#999" }}>No cards saved yet.</p>
        )}

        {savedCards.map((card) => (
          <div
            key={card.id}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: 14,
              border: "1px solid #e8e8e8",
              borderRadius: 10,
              marginBottom: 10,
            }}
          >
            <div>
              <strong>{card.card.brand}</strong> **** {card.card.lastDigits}
              {card.card.expiry && (
                <span style={{ color: "#888", marginLeft: 8, fontSize: 13 }}>
                  Exp {card.card.expiry}
                </span>
              )}
            </div>
            <button
              onClick={() => handleDelete(card.id)}
              style={{
                background: "none",
                border: "none",
                color: "#c62828",
                cursor: "pointer",
                fontSize: 14,
              }}
            >
              Remove
            </button>
          </div>
        ))}
      </section>

      {/* ---- Add card section ---- */}
      <section>
        {!showCardForm ? (
          <button
            onClick={handleAddCard}
            disabled={submitting}
            style={{
              width: "100%",
              padding: 14,
              background: "#0070ba",
              color: "#fff",
              border: "none",
              borderRadius: 10,
              fontSize: 15,
              fontWeight: 600,
              cursor: submitting ? "not-allowed" : "pointer",
              opacity: submitting ? 0.5 : 1,
            }}
          >
            {submitting ? "Preparing..." : "Add a Card"}
          </button>
        ) : (
          <div>
            <h2>Add New Card</h2>
            <p style={{ fontSize: 14, color: "#666", marginBottom: 16 }}>
              Card details are handled securely by PayPal.
            </p>

            {/* Card field containers — PayPal Web Components are appended here */}
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 13, fontWeight: 500, color: "#555" }}>
                Card Number
              </label>
              <div
                ref={cardNumberRef}
                style={{
                  minHeight: 44,
                  border: "1px solid #ddd",
                  borderRadius: 8,
                  padding: 2,
                }}
              />
            </div>

            <div style={{ display: "flex", gap: 12, marginBottom: 14 }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 13, fontWeight: 500, color: "#555" }}>
                  Expiry
                </label>
                <div
                  ref={cardExpiryRef}
                  style={{
                    minHeight: 44,
                    border: "1px solid #ddd",
                    borderRadius: 8,
                    padding: 2,
                  }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 13, fontWeight: 500, color: "#555" }}>
                  CVV
                </label>
                <div
                  ref={cardCvvRef}
                  style={{
                    minHeight: 44,
                    border: "1px solid #ddd",
                    borderRadius: 8,
                    padding: 2,
                  }}
                />
              </div>
            </div>

            <button
              onClick={handleSubmitCard}
              disabled={submitting}
              style={{
                width: "100%",
                padding: 14,
                background: "#0070ba",
                color: "#fff",
                border: "none",
                borderRadius: 10,
                fontSize: 15,
                fontWeight: 600,
                cursor: submitting ? "not-allowed" : "pointer",
                opacity: submitting ? 0.5 : 1,
                marginBottom: 10,
              }}
            >
              {submitting ? "Saving..." : "Save Card"}
            </button>

            <button
              onClick={handleCancel}
              style={{
                width: "100%",
                padding: 14,
                background: "transparent",
                color: "#0070ba",
                border: "2px solid #0070ba",
                borderRadius: 10,
                fontSize: 15,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
