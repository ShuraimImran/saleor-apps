import { useAppBridge } from "@saleor/app-sdk/app-bridge";
import { Box, Button, Input,Text } from "@saleor/macaw-ui";
import { useEffect,useState } from "react";

import { trpcClient } from "@/modules/trpc/trpc-client";

import { ApplePayDomainsSection } from "./apple-pay-domains-section";

type PayPalEnvironment = "SANDBOX" | "LIVE";

export const MerchantConnectionSection = () => {
  const { appBridge, appBridgeState } = useAppBridge();
  const [error, setError] = useState<string | null>(null);
  const [merchantEmail, setMerchantEmail] = useState<string>("");
  const [environment, setEnvironment] = useState<PayPalEnvironment>("SANDBOX");

  // Load tenant config to get current environment
  const tenantConfig = trpcClient.appConfig.getTenantConfig.useQuery(undefined, { retry: false });
  const tenantConfigUpdate = trpcClient.appConfig.setTenantConfig.useMutation({
    onSuccess: () => {
      tenantConfig.refetch();
    },
    onError: (err: any) => {
      setError(`Failed to update environment: ${err.message}`);
    },
  });

  useEffect(() => {
    if (tenantConfig.data) {
      setEnvironment((tenantConfig.data.environment as PayPalEnvironment) ?? "SANDBOX");
    }
  }, [tenantConfig.data]);

  // Set default email from app bridge user
  useEffect(() => {
    const defaultEmail = appBridgeState?.user?.email || "";

    setMerchantEmail(defaultEmail);
  }, [appBridgeState?.user?.email]);

  // Query merchant status by saleorApiUrl (no trackingId needed)
  const {
    data: merchantStatus,
    refetch: refetchStatus,
    isLoading: isLoadingStatus,
  } = trpcClient.merchantOnboarding.getMerchantStatus.useQuery(
    {},
    { retry: false }
  );

  // Get trackingId from the merchant status response if available
  const trackingId = merchantStatus?.trackingId || null;

  // Mutations
  const { mutate: createReferral, isLoading: isCreatingReferral } =
    trpcClient.merchantOnboarding.createMerchantReferral.useMutation({
      onSuccess: async (result) => {
        console.log("PayPal referral created:", result.actionUrl);

        if (!appBridge) {
          setError("AppBridge not available. Please refresh the page and try again.");
          console.error("AppBridge not available");

          return;
        }

        try {
          /*
           * Use AppBridge to open URL in new context (new tab)
           * This works even in sandboxed iframes because it communicates with parent window
           */
          console.log("Dispatching redirect via AppBridge...");

          await appBridge.dispatch({
            type: "redirect",
            payload: {
              actionId: "paypal-onboarding-redirect",
              to: result.actionUrl,
              newContext: true,
            },
          });

          console.log("AppBridge redirect dispatched successfully");
        } catch (error) {
          console.error("AppBridge redirect failed:", error);
          setError(
            "Failed to open PayPal. Please contact support. Error: " +
            (error instanceof Error ? error.message : String(error))
          );
        }
      },
      onError: (err) => {
        setError(`Failed to initiate connection: ${err.message}`);
      },
    });

  const { mutate: refreshStatus, isLoading: isRefreshing } =
    trpcClient.merchantOnboarding.refreshMerchantStatus.useMutation({
      onSuccess: () => {
        refetchStatus();
      },
      onError: (err) => {
        setError(`Failed to refresh status: ${err.message}`);
      },
    });

  const { mutate: deleteMerchant, isLoading: isDeleting } =
    trpcClient.merchantOnboarding.deleteMerchant.useMutation({
      onSuccess: () => {
        console.log("Merchant disconnected successfully");
        // Reload the page to get fresh data
        window.location.reload();
      },
      onError: (err) => {
        console.error("Failed to disconnect merchant:", err);
        setError(`Failed to disconnect: ${err.message}`);
      },
    });

  // Store Saleor context for callback page to use
  useEffect(() => {
    if (appBridgeState?.saleorApiUrl) {
      sessionStorage.setItem("saleorApiUrl", appBridgeState.saleorApiUrl);
    }
    if (appBridgeState?.id) {
      sessionStorage.setItem("appId", appBridgeState.id);
    }
  }, [appBridgeState]);

  const handleConnectPayPal = () => {
    if (!appBridge) {
      setError("AppBridge not available. Please refresh the page and try again.");

      return;
    }

    if (!merchantEmail || !merchantEmail.includes("@")) {
      setError("Please enter a valid email address");

      return;
    }

    setError(null);

    console.log("Creating PayPal referral with email:", merchantEmail);

    // Generate a new tracking ID for this merchant onboarding
    const newTrackingId = crypto.randomUUID();

    createReferral({
      trackingId: newTrackingId,
      merchantEmail: merchantEmail.trim(),
      merchantCountry: "US",
      returnUrl: `${window.location.origin}/paypal-callback`,
      returnUrlDescription: "Return to store",
    });
  };

  const handleRefreshStatus = () => {
    if (!trackingId) return;
    setError(null);
    refreshStatus({ trackingId });
  };

  const handleDisconnectClick = () => {
    if (!trackingId) return;
    setError(null);
    deleteMerchant({ trackingId });
  };

  const handleEnvironmentChange = (newEnv: PayPalEnvironment) => {
    // Block switching if a merchant is onboarded on a different environment
    if (merchantStatus && onboardingEnvironment && onboardingEnvironment !== newEnv) {
      setError(
        `Cannot switch to ${newEnv} mode while a merchant is connected in ${onboardingEnvironment} mode. Please disconnect the current merchant first.`
      );

      return;
    }

    setError(null);
    setEnvironment(newEnv);
    tenantConfigUpdate.mutate({
      softDescriptor: tenantConfig.data?.softDescriptor,
      environment: newEnv,
    });
  };

  const isLoading = isLoadingStatus || isCreatingReferral || isRefreshing || isDeleting;

  const isPending = merchantStatus?.onboardingStatus === "PENDING";
  const isInProgress = merchantStatus?.onboardingStatus === "IN_PROGRESS";
  const isCompleted = merchantStatus?.onboardingStatus === "COMPLETED";
  const onboardingEnvironment = merchantStatus?.onboardingEnvironment as PayPalEnvironment | undefined;
  const hasEnvironmentMismatch = onboardingEnvironment && onboardingEnvironment !== environment;

  const environmentToggle = (
    <Box
      marginBottom={2}
    >
      {/* Header row with title and badge */}
      <Box display="flex" justifyContent="space-between" alignItems="center" marginBottom={4}>
        <Text size={4} fontWeight="bold">
          PayPal Environment
        </Text>
        <Box
          paddingX={3}
          paddingY={1}
          __borderRadius="16px"
          __backgroundColor={environment === "LIVE" ? "#D1FAE5" : "#FEF3C7"}
        >
          <Text size={2} fontWeight="bold" __color={environment === "LIVE" ? "#065F46" : "#92400E"}>
            {environment === "LIVE" ? "Production" : "Test Mode"}
          </Text>
        </Box>
      </Box>

      {/* Toggle buttons */}
      <Box
        display="flex"
        __borderRadius="9999px"
        __backgroundColor="#F1F5F9"
        __padding="4px"
        marginBottom={4}
      >
        <Box
          __flex="1"
          paddingY={2}
          display="flex"
          justifyContent="center"
          alignItems="center"
          __cursor="pointer"
          __borderRadius="9999px"
          __backgroundColor={environment === "SANDBOX" ? "#1E293B" : "transparent"}
          __transition="background-color 0.2s"
          onClick={() => {
            if (!isLoading && !tenantConfigUpdate.isLoading) {
              handleEnvironmentChange("SANDBOX");
            }
          }}
        >
          <Text
            size={3}
            fontWeight="bold"
            __color={environment === "SANDBOX" ? "#FFFFFF" : "#64748B"}
          >
            Sandbox
          </Text>
        </Box>
        <Box
          __flex="1"
          paddingY={2}
          display="flex"
          justifyContent="center"
          alignItems="center"
          __cursor="pointer"
          __borderRadius="9999px"
          __backgroundColor={environment === "LIVE" ? "#1E293B" : "transparent"}
          __transition="background-color 0.2s"
          onClick={() => {
            if (!isLoading && !tenantConfigUpdate.isLoading) {
              handleEnvironmentChange("LIVE");
            }
          }}
        >
          <Text
            size={3}
            fontWeight="bold"
            __color={environment === "LIVE" ? "#FFFFFF" : "#64748B"}
          >
            Live
          </Text>
        </Box>
      </Box>

      {/* Info message */}
      <Box
        padding={3}
        borderRadius={4}
        __backgroundColor="#F0F9FF"
        borderWidth={1}
        borderColor="info1"
        display="flex"
        alignItems="center"
        gap={2}
      >
        <Box
          __width="20px"
          __height="20px"
          __minWidth="20px"
          __borderRadius="50%"
          style={{ border: "1.5px solid #0369A1" }}
          display="flex"
          alignItems="center"
          justifyContent="center"
        >
          <Text __color="#0369A1" fontWeight="bold" __fontSize="12px" __lineHeight="1">
            i
          </Text>
        </Box>
        <Text size={2} __color="#0369A1">
          {environment === "LIVE"
            ? "Merchants will onboard with real PayPal accounts and process real payments."
            : "Merchants will onboard with PayPal sandbox accounts for testing."}
        </Text>
      </Box>
    </Box>
  );

  const errorBanner = error ? (
    <Box
      padding={4}
      borderRadius={4}
      borderWidth={1}
      borderColor="critical1"
      __backgroundColor="#FEF2F2"
      display="flex"
      alignItems="center"
      gap={3}
    >
      <Box
        __width="22px"
        __height="22px"
        __minWidth="22px"
        __borderRadius="50%"
        style={{ border: "1.5px solid #DC2626" }}
        display="flex"
        alignItems="center"
        justifyContent="center"
      >
        <Text __color="#DC2626" fontWeight="bold" __fontSize="13px" __lineHeight="1">
          !
        </Text>
      </Box>
      <Text color="critical1" fontWeight="medium">
        {error}
      </Text>
    </Box>
  ) : null;

  if (!merchantStatus) {
    // Not connected state
    return (
      <Box display="flex" flexDirection="column" gap={5}>
        {errorBanner}

        {environmentToggle}

        <Box
          padding={6}
          borderRadius={4}
          borderWidth={1}
          borderColor="default1"
          __backgroundColor="#FAFAFA"
        >
          <Box marginBottom={5}>
            <Text size={4} fontWeight="medium">
              Get Started with PayPal
            </Text>
          </Box>
          <Box marginBottom={5}>
            <Text size={3} color="default2">
              Connect your PayPal merchant account to enable payment processing for your store.
            </Text>
          </Box>

          <Box display="flex" flexDirection="column" gap={2} marginTop={3} marginBottom={5}>
            <Text size={3} fontWeight="medium">
              PayPal Account Email
            </Text>
            <Input
              type="email"
              value={merchantEmail}
              onChange={(e) => setMerchantEmail(e.target.value)}
              placeholder="your-business@example.com"
              disabled={isLoading}
              size="large"
            />
            <Text size={2} color="default2">
              Enter the email address associated with your PayPal merchant account.
            </Text>
          </Box>

          <Button
            variant="primary"
            onClick={handleConnectPayPal}
            disabled={isLoading || !merchantEmail}
            size="large"
          >
            {isLoading ? "Connecting..." : "Connect PayPal Account"}
          </Button>

          <Box
            marginTop={4}
            padding={3}
            borderRadius={4}
            __backgroundColor="#EFF6FF"
            borderWidth={1}
            borderColor="info1"
          >
            <Text size={2} color="default2">
              You will be securely redirected to PayPal to authorize the connection.
              Once completed, you will be brought back to this page.
            </Text>
          </Box>
        </Box>
      </Box>
    );
  }

  // Determine status display
  const getStatusBadge = () => {
    if (isCompleted && merchantStatus.paymentsReceivable) {
      return (
        <Box
          paddingX={4}
          paddingY={2}
          __borderRadius="20px"
          __backgroundColor="#0D9488"
        >
          <Text size={2} fontWeight="medium" __color="#FFFFFF">
            Ready to receive payments
          </Text>
        </Box>
      );
    }

    if (isPending) {
      return (
        <Box paddingX={3} paddingY={1} __borderRadius="4px" __backgroundColor="#D97706">
          <Text size={2} fontWeight="medium" __color="#FFFFFF">
            Onboarding not completed
          </Text>
        </Box>
      );
    }

    if (isInProgress) {
      return (
        <Box paddingX={3} paddingY={1} __borderRadius="4px" __backgroundColor="#D97706">
          <Text size={2} fontWeight="medium" __color="#FFFFFF">
            Setup in progress
          </Text>
        </Box>
      );
    }

    return (
      <Box paddingX={3} paddingY={1} __borderRadius="4px" __backgroundColor="#D97706">
        <Text size={2} fontWeight="medium" __color="#FFFFFF">
          Pending verification
        </Text>
      </Box>
    );
  };

  const getHeaderText = () => {
    if (isPending) return "PayPal Onboarding Started";
    if (isCompleted && merchantStatus.paymentsReceivable) return "PayPal Account Connected";

    return "PayPal Account Linked";
  };

  const getHeaderColor = () => {
    if (isPending) return "#F59E0B";
    if (isCompleted && merchantStatus.paymentsReceivable) return "#10B981";

    return "#2563EB";
  };

  const getBorderColor = () => {
    if (isPending) return "warning1" as const;
    if (isCompleted && merchantStatus.paymentsReceivable) return "success1" as const;

    return "info1" as const;
  };

  const getBgColor = () => {
    if (isPending) return "#FFFBEB";
    if (isCompleted && merchantStatus.paymentsReceivable) return "#F0FDF4";

    return "#EFF6FF";
  };

  // Connected / In-progress state
  return (
    <Box display="flex" flexDirection="column" gap={5}>
      {errorBanner}

      {environmentToggle}

      {/* Environment mismatch warning */}
      {hasEnvironmentMismatch && (
        <Box
          padding={5}
          borderRadius={4}
          borderWidth={1}
          borderColor="critical1"
          __backgroundColor="#FEF2F2"
        >
          <Box marginBottom={3}>
            <Text size={3} fontWeight="bold" color="critical1">
              Environment Mismatch
            </Text>
          </Box>
          <Box marginBottom={3}>
            <Text size={3} color="default2">
              This merchant was onboarded in <strong>{onboardingEnvironment}</strong> mode,
              but the tenant is now set to <strong>{environment}</strong> mode.
            </Text>
          </Box>
          <Box marginBottom={4}>
            <Text size={3} color="default2">
              To use {environment} mode, disconnect the current merchant and re-onboard
              with a {environment === "LIVE" ? "real" : "sandbox"} PayPal account.
            </Text>
          </Box>
          <Button
            variant="primary"
            size="small"
            onClick={handleDisconnectClick}
            disabled={isLoading}
          >
            {isDeleting ? "Disconnecting..." : "Disconnect and Re-onboard"}
          </Button>
        </Box>
      )}

      {/* Pending onboarding warning - shown prominently */}
      {isPending && (
        <Box
          padding={5}
          borderRadius={4}
          borderWidth={1}
          borderColor="warning1"
          __backgroundColor="#FFFBEB"
        >
          <Box marginBottom={4}>
            <Text size={3} fontWeight="bold" color="warning1">
              Complete PayPal Onboarding
            </Text>
          </Box>
          <Box marginBottom={3}>
            <Text size={3} color="default2">
              You have started the connection process but have not completed the PayPal
              onboarding yet. Please complete the setup in the PayPal window that was opened.
            </Text>
          </Box>
          <Box marginBottom={5}>
            <Text size={3} color="default2">
              If you closed the window, you can click the button below to restart the process.
            </Text>
          </Box>
          <Button
            variant="primary"
            size="small"
            onClick={handleConnectPayPal}
            disabled={isLoading || !merchantEmail}
          >
            {isLoading ? "Connecting..." : "Restart PayPal Onboarding"}
          </Button>
        </Box>
      )}

      {/* Account status card */}
      <Box
        borderRadius={4}
        borderWidth={1}
        borderColor="default1"
        __overflow="hidden"
      >
        {/* Gradient header */}
        <Box
          paddingX={5}
          paddingY={3}
          style={{
            background: isCompleted && merchantStatus.paymentsReceivable
              ? "linear-gradient(135deg, #0D9488, #14B8A6, #2DD4BF)"
              : "linear-gradient(135deg, #D97706, #F59E0B, #FBBF24)",
          }}
        >
          <Box display="flex" gap={2} alignItems="center">
            {/* Icon centered vertically between the two text lines */}
            <Box
              __width="32px"
              __height="32px"
              __minWidth="32px"
              __borderRadius="50%"
              __backgroundColor="rgba(255,255,255,0.25)"
              display="flex"
              alignItems="center"
              justifyContent="center"
            >
              <Text __color="#FFFFFF" fontWeight="bold" __fontSize="16px">
                {isCompleted && merchantStatus.paymentsReceivable ? "\u2713" : "\u2022\u2022\u2022"}
              </Text>
            </Box>
            <Box display="flex" flexDirection="column">
              <Text size={5} fontWeight="bold" __color="#FFFFFF" __lineHeight="1.3">
                {getHeaderText()}
              </Text>
              <Text size={3} __color="rgba(255,255,255,0.85)" __lineHeight="1.3">
                {isCompleted && merchantStatus.paymentsReceivable
                  ? "Your account is ready to accept payments"
                  : isPending
                    ? "Complete the onboarding process to start accepting payments"
                    : "Your account is being verified by PayPal"}
              </Text>
            </Box>
          </Box>
        </Box>

        {/* Details section */}
        <Box __backgroundColor="#FFFFFF">
          {/* Email */}
          <Box
            paddingX={5}
            paddingY={4}
            borderBottomWidth={1}
            borderColor="default1"
            __backgroundColor="#FAFAFA"
            display="flex"
            flexDirection="column"
            gap={1}
          >
            <Text size={2} fontWeight="medium" __color="#6B7280">
              Email Address
            </Text>
            <Text size={3} fontWeight="medium">
              {merchantStatus.merchantEmail || "Not provided"}
            </Text>
          </Box>

          {/* Tracking ID */}
          <Box
            paddingX={5}
            paddingY={4}
            borderBottomWidth={1}
            borderColor="default1"
            __backgroundColor="#FAFAFA"
            display="flex"
            flexDirection="column"
            gap={1}
          >
            <Text size={2} fontWeight="medium" __color="#6B7280">
              Tracking ID
            </Text>
            <Text size={3} fontWeight="medium" __color="#374151">
              {merchantStatus.trackingId}
            </Text>
          </Box>

        </Box>
      </Box>

      {/* Status - outside the card to align with outer edges */}
      <Box display="flex" justifyContent="space-between" alignItems="center">
        <Text size={3} fontWeight="medium" __color="#6B7280">
          Status
        </Text>
        {getStatusBadge()}
      </Box>

      {/* Payment Methods */}
      <Box>
        <Text size={4} marginBottom={5} fontWeight="medium">
          Payment Methods
        </Text>
        <Box
          display="grid"
          __gridTemplateColumns="1fr 1fr"
          gap={3}
        >
          <PaymentMethodBadge
            label="PayPal Buttons"
            enabled={merchantStatus.paymentMethods?.paypalButtons || false}
          />
          <PaymentMethodBadge
            label="Card Processing"
            enabled={merchantStatus.paymentMethods?.advancedCardProcessing || false}
          />
          <PaymentMethodBadge
            label="Apple Pay"
            enabled={merchantStatus.paymentMethods?.applePay || false}
          />
          <PaymentMethodBadge
            label="Google Pay"
            enabled={merchantStatus.paymentMethods?.googlePay || false}
          />
        </Box>
      </Box>

      {/* Apple Pay Domain Management */}
      {trackingId && (
        <ApplePayDomainsSection
          trackingId={trackingId}
          applePayEnabled={merchantStatus.paymentMethods?.applePay || false}
        />
      )}

      <Box display="flex" gap={3} flexWrap="wrap">
        {!isPending && (
          <Button
            variant="secondary"
            onClick={handleRefreshStatus}
            disabled={isLoading}
            title="Refresh payment method status from PayPal"
          >
            {isRefreshing ? "Refreshing..." : "Refresh Status"}
          </Button>
        )}
        <Button variant="tertiary" onClick={handleDisconnectClick} disabled={isLoading}>
          {isDeleting ? "Disconnecting..." : "Disconnect"}
        </Button>
      </Box>

      {merchantStatus.lastStatusCheck && (
        <Text size={2} color="default2">
          Last updated: {new Date(merchantStatus.lastStatusCheck).toLocaleString()}
        </Text>
      )}
    </Box>
  );
};

const PaymentMethodBadge = ({ label, enabled }: { label: string; enabled: boolean }) => {
  return (
    <Box
      paddingX={4}
      paddingY={3}
      borderRadius={4}
      borderWidth={1}
      borderColor={enabled ? "success1" : "default1"}
      __backgroundColor={enabled ? "#F0FDFA" : "#F9FAFB"}
      display="flex"
      alignItems="center"
      justifyContent="space-between"
    >
      <Text size={3} fontWeight="medium" __color={enabled ? "#374151" : "#9CA3AF"}>
        {label}
      </Text>
      <Box
        __width="22px"
        __height="22px"
        __borderRadius="50%"
        __backgroundColor={enabled ? "#10B981" : "#D1D5DB"}
        display="flex"
        alignItems="center"
        justifyContent="center"
      >
        <Text __color="#FFFFFF" fontWeight="bold" __fontSize="12px" __lineHeight="1">
          {enabled ? "\u2713" : "\u2717"}
        </Text>
      </Box>
    </Box>
  );
};
