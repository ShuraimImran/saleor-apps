import { Box, Text } from "@saleor/macaw-ui";
import { NextPage } from "next";
import { useEffect, useState } from "react";

/**
 * Public callback page for PayPal merchant onboarding
 *
 * This page receives the redirect from PayPal after merchant completes signup.
 * It calls the server-side API to save the merchant ID directly, then shows
 * a success message instructing the admin to return to the Saleor Dashboard.
 */
const PayPalCallbackPage: NextPage = () => {
  const [status, setStatus] = useState<"processing" | "success" | "error">("processing");
  const [message, setMessage] = useState<string>("Processing PayPal response...");

  useEffect(() => {
    const handleCallback = async () => {
      try {
        // Get all parameters from URL
        const urlParams = new URLSearchParams(window.location.search);
        const merchantIdInPayPal = urlParams.get("merchantIdInPayPal");
        const merchantId = urlParams.get("merchantId"); // This is the trackingId

        console.log("PayPal callback received:", {
          merchantIdInPayPal,
          merchantId,
          isEmailConfirmed: urlParams.get("isEmailConfirmed"),
          accountStatus: urlParams.get("accountStatus"),
          permissionsGranted: urlParams.get("permissionsGranted"),
          consentStatus: urlParams.get("consentStatus"),
          riskStatus: urlParams.get("riskStatus"),
        });

        if (!merchantIdInPayPal) {
          setStatus("error");
          setMessage("Missing merchant ID from PayPal response.");

          return;
        }

        const trackingId = merchantId;

        if (!trackingId) {
          setStatus("error");
          setMessage("Tracking ID not found in callback URL. Please restart the connection process.");

          return;
        }

        // Call server-side API to save the merchant ID directly
        const response = await fetch("/api/paypal-callback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            trackingId,
            merchantIdInPayPal,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));

          console.error("Callback API error:", errorData);
          setStatus("error");
          setMessage(
            `Failed to save PayPal connection: ${errorData.error || response.statusText}`
          );

          return;
        }

        const result = await response.json();

        console.log("Callback API response:", result);

        setStatus("success");
        setMessage("PayPal account connected successfully!");
      } catch (error) {
        console.error("Error processing PayPal callback:", error);
        setStatus("error");
        setMessage(
          `Error connecting PayPal account: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    };

    handleCallback();
  }, []);

  return (
    <Box
      display="flex"
      justifyContent="center"
      alignItems="center"
      style={{ minHeight: "100vh" }}
      padding={8}
    >
      <Box
        display="flex"
        flexDirection="column"
        gap={4}
        style={{ maxWidth: "500px", textAlign: "center" }}
      >
        {status === "processing" && (
          <>
            <Box
              style={{
                width: "60px",
                height: "60px",
                border: "4px solid #f3f3f3",
                borderTop: "4px solid #0070ba",
                borderRadius: "50%",
                animation: "spin 1s linear infinite",
                margin: "0 auto",
              }}
            />
            <style>{`
              @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
              }
            `}</style>
          </>
        )}

        {status === "success" && (
          <Text size={10} style={{ fontSize: "48px", color: "#10B981" }}>
            +
          </Text>
        )}

        {status === "error" && (
          <Text size={10} style={{ fontSize: "48px", color: "#d32f2f" }}>
            x
          </Text>
        )}

        <Text size={5} fontWeight="bold">
          {message}
        </Text>

        {status === "success" && (
          <Box
            padding={4}
            borderRadius={4}
            __backgroundColor="#EFF6FF"
            borderWidth={1}
            borderColor="info1"
          >
            <Text size={3} color="default2">
              Return to your Saleor admin dashboard and refresh the page to see
              your updated PayPal connection status.
            </Text>
          </Box>
        )}

        {status === "error" && (
          <Text color="default2">
            Please close this window and try connecting your PayPal account again from the
            configuration page.
          </Text>
        )}
      </Box>
    </Box>
  );
};

export default PayPalCallbackPage;
