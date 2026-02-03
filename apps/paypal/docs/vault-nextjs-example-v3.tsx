/**
 * Vault Without Purchase — Next.js Reference Implementation (v3)
 *
 * Changes from v1:
 * - Card field rendering moved to useEffect (guarantees refs are in DOM)
 * - SDK init separated from card field mounting
 * - Added console logs for debugging
 *
 * Prerequisites:
 * - Buyer is authenticated (you have their Saleor JWT from `tokenCreate`)
 * - PayPal Payment App is running and configured
 * - Advanced Vaulting is enabled on the PayPal merchant account
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Script from "next/script";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const PAYMENT_APP_URL = process.env.NEXT_PUBLIC_PAYPAL_APP_URL!;
const SALEOR_API_URL = process.env.NEXT_PUBLIC_API_URL!;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// tRPC helpers
// ---------------------------------------------------------------------------
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
      data.error?.json?.message ||
      data.error?.message ||
      JSON.stringify(data.error);
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
      data.error?.json?.message ||
      data.error?.message ||
      JSON.stringify(data.error);
    throw new Error(msg);
  }

  return (data.result?.data ?? data) as T;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function SavedPaymentMethodsPage() {
  // TODO: Replace with your auth context — e.g. useAuth().token
  const userToken = "YOUR_SALEOR_JWT_HERE";

  const [savedCards, setSavedCards] = useState<SavedCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCardForm, setShowCardForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [sdkScriptLoaded, setSdkScriptLoaded] = useState(false);

  // This flag tells the useEffect to mount card fields after React renders the containers
  const [readyToMountFields, setReadyToMountFields] = useState(false);

  // Refs for PayPal SDK objects
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const vaultSessionRef = useRef<any>(null);
  const setupTokenIdRef = useRef<string | null>(null);

  // Refs for card field containers
  const cardNumberRef = useRef<HTMLDivElement>(null);
  const cardExpiryRef = useRef<HTMLDivElement>(null);
  const cardCvvRef = useRef<HTMLDivElement>(null);

  // ----------------------------------------------------------
  // Load saved cards
  // ----------------------------------------------------------
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
      setError(
        err instanceof Error ? err.message : "Failed to load saved cards",
      );
    } finally {
      setLoading(false);
    }
  }, [userToken]);

  useEffect(() => {
    loadSavedCards();
  }, [loadSavedCards]);

  // ----------------------------------------------------------
  // Mount card fields AFTER React has rendered the containers
  // ----------------------------------------------------------
  useEffect(() => {
    if (!readyToMountFields || !vaultSessionRef.current) return;

    const session = vaultSessionRef.current;

    console.log("[Vault] Mounting card field Web Components into DOM");

    // Create the PayPal Web Components
    const numberField = session.createCardFieldsComponent({ type: "number" });
    const expiryField = session.createCardFieldsComponent({ type: "expiry" });
    const cvvField = session.createCardFieldsComponent({ type: "cvv" });

    // Clear any previous children
    if (cardNumberRef.current) cardNumberRef.current.innerHTML = "";
    if (cardExpiryRef.current) cardExpiryRef.current.innerHTML = "";
    if (cardCvvRef.current) cardCvvRef.current.innerHTML = "";

    // Append Web Components to the DOM
    if (cardNumberRef.current) {
      cardNumberRef.current.appendChild(numberField);
      console.log("[Vault] number field appended");
    } else {
      console.error("[Vault] cardNumberRef is null — container not in DOM");
    }

    if (cardExpiryRef.current) {
      cardExpiryRef.current.appendChild(expiryField);
      console.log("[Vault] expiry field appended");
    } else {
      console.error("[Vault] cardExpiryRef is null — container not in DOM");
    }

    if (cardCvvRef.current) {
      cardCvvRef.current.appendChild(cvvField);
      console.log("[Vault] cvv field appended");
    } else {
      console.error("[Vault] cardCvvRef is null — container not in DOM");
    }

    console.log("[Vault] All card fields mounted");

    setReadyToMountFields(false);
  }, [readyToMountFields]);

  // ----------------------------------------------------------
  // Delete a saved card
  // ----------------------------------------------------------
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

  // ----------------------------------------------------------
  // Start the "Add Card" flow
  // ----------------------------------------------------------
  const handleAddCard = async () => {
    setError(null);
    setSuccessMessage(null);
    setSubmitting(true);

    try {
      // Step 1a: Create setup token
      console.log("[Vault] Creating setup token...");
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
      console.log("[Vault] Setup token created:", setupResult.setupTokenId);
      setupTokenIdRef.current = setupResult.setupTokenId;

      // Step 1b: Get client token for SDK v6
      console.log("[Vault] Fetching client token...");
      const { clientToken } = await trpcQuery<{ clientToken: string }>(
        "customerVault.generateClientToken",
        {},
        userToken,
      );
      console.log("[Vault] Client token received");

      // Step 2: Initialize SDK
      if (!sdkScriptLoaded) {
        throw new Error("PayPal SDK script not loaded yet. Please try again.");
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const paypal = (window as any).paypal;
      if (!paypal?.createInstance) {
        throw new Error("PayPal SDK v6 not available on window");
      }

      console.log("[Vault] Creating SDK instance...");
      const sdk = await paypal.createInstance({
        clientToken,
        components: ["card-fields"],
      });
      console.log("[Vault] SDK instance created");

      // Step 3: Create vault session
      const session = sdk.createCardFieldsSavePaymentSession();
      vaultSessionRef.current = session;
      console.log("[Vault] Vault session created");

      // Show the card form — React will render the container divs
      setShowCardForm(true);

      // Signal the useEffect to mount card fields on the NEXT render
      // (after React has flushed showCardForm=true and the refs exist)
      setReadyToMountFields(true);
    } catch (err) {
      console.error("[Vault] Error:", err);
      setError(
        err instanceof Error ? err.message : "Failed to start vault flow",
      );
      setShowCardForm(false);
    } finally {
      setSubmitting(false);
    }
  };

  // ----------------------------------------------------------
  // Submit card details
  // ----------------------------------------------------------
  const handleSubmitCard = async () => {
    if (!vaultSessionRef.current || !setupTokenIdRef.current) return;

    setSubmitting(true);
    setError(null);

    try {
      console.log("[Vault] Submitting card...");
      const result = await vaultSessionRef.current.submit(
        setupTokenIdRef.current,
      );
      console.log("[Vault] Submit result:", result);

      switch (result.state) {
        case "succeeded": {
          console.log("[Vault] Card approved, creating payment token...");
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
          setError(
            `Card validation failed: ${result.data?.message || "Unknown error"}`,
          );
          break;

        default:
          setError(`Unexpected result: ${result.state}`);
      }
    } catch (err) {
      console.error("[Vault] Submit error:", err);
      setError(err instanceof Error ? err.message : "Card submission failed");
    } finally {
      setSubmitting(false);
    }
  };

  // ----------------------------------------------------------
  // Cancel
  // ----------------------------------------------------------
  const handleCancel = () => {
    setShowCardForm(false);
    setError(null);
    setupTokenIdRef.current = null;
    vaultSessionRef.current = null;
  };

  // ----------------------------------------------------------
  // Render
  // ----------------------------------------------------------
  return (
    <div style={{ maxWidth: 480, margin: "0 auto", padding: 20 }}>
      {/* PayPal SDK v6 — loaded once, no query params */}
      <Script
        src="https://www.sandbox.paypal.com/web-sdk/v6/core"
        strategy="afterInteractive"
        onLoad={() => {
          console.log("[SDK] PayPal SDK v6 script loaded");
          setSdkScriptLoaded(true);
        }}
        onError={() => {
          console.error("[SDK] Failed to load PayPal SDK v6 script");
          setError("Failed to load PayPal SDK");
        }}
      />

      <h1>My Payment Methods</h1>

      {/* Status messages */}
      {error && (
        <div
          style={{
            background: "#ffebee",
            color: "#c62828",
            padding: 12,
            borderRadius: 8,
            marginBottom: 16,
          }}
        >
          {error}
        </div>
      )}
      {successMessage && (
        <div
          style={{
            background: "#e8f5e9",
            color: "#2e7d32",
            padding: 12,
            borderRadius: 8,
            marginBottom: 16,
          }}
        >
          {successMessage}
        </div>
      )}

      {/* Saved cards list */}
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

      {/* Add card section */}
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

            {/*
              Card field containers — PayPal Web Components get appended here
              by the useEffect above. The refs MUST be in the DOM before
              appendChild is called.
            */}
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
