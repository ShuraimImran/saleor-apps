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
  const [liveEnabled, setLiveEnabled] = useState(false);
  const [pendingMethod, setPendingMethod] = useState<string | null>(null);

  // Load tenant config to get current environment
  const tenantConfig = trpcClient.appConfig.getTenantConfig.useQuery(undefined, { retry: false });
  const tenantConfigUpdate = trpcClient.appConfig.setTenantConfig.useMutation({
    onSuccess: () => {
      tenantConfig.refetch();
    },
    onError: (err: any) => {
      setError(`Failed to update environment: ${err.message}`);
      setTimeout(() => setError(null), 3000);
    },
  });

  useEffect(() => {
    if (tenantConfig.data) {
      setEnvironment((tenantConfig.data.environment as PayPalEnvironment) ?? "SANDBOX");
      setLiveEnabled(tenantConfig.data.liveEnabled ?? false);
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

          // Refetch status to show the PENDING state immediately
          refetchStatus();
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
        setTimeout(() => setError(null), 3000);
      },
    });

  const { mutate: setPaymentMethodPreferences } =
    trpcClient.merchantOnboarding.setPaymentMethodPreferences.useMutation({
      onSuccess: () => {
        refetchStatus();
      },
      onError: (err) => {
        setError(`Failed to update payment method: ${err.message}`);
        setTimeout(() => setError(null), 4000);
      },
      onSettled: () => {
        setPendingMethod(null);
      },
    });

  const handleTogglePaymentMethod = (
    method: "paypalButtons" | "card" | "applePay" | "googlePay",
    nextEnabled: boolean
  ) => {
    setError(null);
    setPendingMethod(method);
    setPaymentMethodPreferences({ [method]: nextEnabled });
  };

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

  // Query Saleor metadata to check if PayPal config exists
  const saleorConfigs = trpcClient.appConfig.getPayPalConfigsList.useQuery(undefined, { retry: false });

  // Auto-refresh merchant status when needed
  const [autoRefreshDone, setAutoRefreshDone] = useState(false);

  useEffect(() => {
    if (autoRefreshDone || !merchantStatus || !trackingId || isRefreshing) {
      return;
    }

    const hasPaypalMerchantId = !!merchantStatus.paypalMerchantId;

    // Skip auto-refresh for freshly created PENDING records (within last 30 seconds)
    const recordAge = merchantStatus.createdAt
      ? Date.now() - new Date(merchantStatus.createdAt).getTime()
      : Infinity;
    const isFreshRecord = recordAge < 30000;

    const isPendingNeedsCheck =
      merchantStatus.onboardingStatus === "PENDING" && !isFreshRecord;
    const isInProgressWithMerchantId =
      merchantStatus.onboardingStatus === "IN_PROGRESS" && hasPaypalMerchantId;
    const isCompletedButNoMetadata =
      merchantStatus.onboardingStatus === "COMPLETED" &&
      saleorConfigs.data !== undefined &&
      (!saleorConfigs.data || saleorConfigs.data.length === 0);

    if (isPendingNeedsCheck || isInProgressWithMerchantId || isCompletedButNoMetadata) {
      const reason = isPendingNeedsCheck
        ? "PENDING - checking if merchant completed onboarding on PayPal"
        : isInProgressWithMerchantId
          ? "IN_PROGRESS with merchant ID"
          : "COMPLETED but no Saleor metadata";

      console.log("Auto-refreshing merchant status", { reason });
      setAutoRefreshDone(true);
      refreshStatus({ trackingId });
    }
  }, [merchantStatus, trackingId, saleorConfigs.data, autoRefreshDone, isRefreshing]);

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
    // Block switching to LIVE if not enabled by admin
    if (newEnv === "LIVE" && !liveEnabled) {
      setError(
        "Production access is not enabled for this tenant. Please contact your WSM administrator to enable live mode."
      );
      setTimeout(() => setError(null), 2500);

      return;
    }

    // Block switching if a merchant is onboarded on a different environment
    if (merchantStatus && onboardingEnvironment && onboardingEnvironment !== newEnv) {
      setError(
        `Cannot switch to ${newEnv} mode while a merchant is connected in ${onboardingEnvironment} mode. Please disconnect the current merchant first.`
      );
      setTimeout(() => setError(null), 2500);

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
  const canProcessPayments = merchantStatus?.primaryEmailConfirmed && merchantStatus?.paymentsReceivable;

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
          display="flex"
          alignItems="center"
          gap={2}
        >
          <Text __color="#FFFFFF" fontWeight="bold" __fontSize="13px">
            {"\u2713"}
          </Text>
          <Text size={2} fontWeight="medium" __color="#FFFFFF">
            Ready to receive payments
          </Text>
        </Box>
      );
    }

    if (isPending) {
      return (
        <Box
          paddingX={3}
          __borderRadius="4px"
          __backgroundColor="#3B82F6"
          display="flex"
          alignItems="center"
          justifyContent="center"
          gap={2}
          __height="28px"
        >
          <Text __color="#FFFFFF" fontWeight="bold" __fontSize="12px" __lineHeight="1">
            {"\u25CB"}
          </Text>
          <Text size={2} fontWeight="medium" __color="#FFFFFF" __lineHeight="1">
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
          <Box marginBottom={4} display="flex" alignItems="center" justifyContent="space-between">
            <Text size={3} fontWeight="bold" color="warning1">
              Complete PayPal Onboarding
            </Text>
            <Box
              display="flex"
              alignItems="center"
              gap={1}
              __cursor={isRefreshing ? "default" : "pointer"}
              __opacity={isRefreshing ? "0.5" : "1"}
              onClick={() => {
                if (!isRefreshing && trackingId) {
                  refreshStatus({ trackingId });
                }
              }}
            >
              <Text size={2} __color="#92400E" fontWeight="medium">
                {isRefreshing ? "Checking..." : "\u21BB Refresh Status"}
              </Text>
            </Box>
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
              : isPending
                ? "linear-gradient(135deg, #1E40AF, #3B82F6, #60A5FA)"
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
            <Text size={1} __color="#9CA3AF">
              Email provided during setup. The merchant may have used a different email on PayPal.
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

      {/* Email confirmation warning */}
      {!merchantStatus.primaryEmailConfirmed && !isPending && (
        <Box
          padding={4}
          borderRadius={4}
          borderWidth={1}
          borderColor="warning1"
          __backgroundColor="#FFFBEB"
          display="flex"
          alignItems="center"
          gap={3}
        >
          <Box
            __width="22px"
            __height="22px"
            __minWidth="22px"
            __borderRadius="50%"
            style={{ border: "1.5px solid #D97706" }}
            display="flex"
            alignItems="center"
            justifyContent="center"
          >
            <Text __color="#D97706" fontWeight="bold" __fontSize="13px" __lineHeight="1">
              !
            </Text>
          </Box>
          <Text size={2} __color="#92400E" fontWeight="medium">
            Please confirm your primary email address on PayPal to start receiving payments.
          </Text>
        </Box>
      )}

      {/* Payment Methods */}
      <Box __opacity={canProcessPayments ? "1" : "0.5"}>
        <Box marginBottom={3}>
          <Text size={4} fontWeight="medium">
            Payment Methods
          </Text>
        </Box>
        <Box marginBottom={5}>
          <Text size={2} color="default2">
            Enable or disable the payment methods shown at checkout. Methods PayPal has not
            approved for your account cannot be enabled.
          </Text>
        </Box>
        <Box display="flex" flexDirection="column" gap={3}>
          <PaymentMethodToggle
            label="PayPal Buttons"
            allowed={!!canProcessPayments && (merchantStatus.paymentMethods?.paypalButtons || false)}
            enabled={merchantStatus.paymentMethodPreferences?.paypalButtons || false}
            saving={pendingMethod === "paypalButtons"}
            disabled={!canProcessPayments || pendingMethod !== null}
            onToggle={(next) => handleTogglePaymentMethod("paypalButtons", next)}
          />
          <PaymentMethodToggle
            label="Card Processing"
            allowed={!!canProcessPayments && (merchantStatus.paymentMethods?.advancedCardProcessing || false)}
            enabled={merchantStatus.paymentMethodPreferences?.advancedCardProcessing || false}
            saving={pendingMethod === "card"}
            disabled={!canProcessPayments || pendingMethod !== null}
            onToggle={(next) => handleTogglePaymentMethod("card", next)}
          />
          <PaymentMethodToggle
            label="Apple Pay"
            allowed={!!canProcessPayments && (merchantStatus.paymentMethods?.applePay || false)}
            enabled={merchantStatus.paymentMethodPreferences?.applePay || false}
            saving={pendingMethod === "applePay"}
            disabled={!canProcessPayments || pendingMethod !== null}
            onToggle={(next) => handleTogglePaymentMethod("applePay", next)}
          />
          <PaymentMethodToggle
            label="Google Pay"
            allowed={!!canProcessPayments && (merchantStatus.paymentMethods?.googlePay || false)}
            enabled={merchantStatus.paymentMethodPreferences?.googlePay || false}
            saving={pendingMethod === "googlePay"}
            disabled={!canProcessPayments || pendingMethod !== null}
            onToggle={(next) => handleTogglePaymentMethod("googlePay", next)}
          />
        </Box>
      </Box>

      {/* Apple Pay Domain Management */}
      {trackingId && (
        <ApplePayDomainsSection
          trackingId={trackingId}
          applePayEnabled={merchantStatus.paymentMethodPreferences?.applePay || false}
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

const PaymentMethodToggle = ({
  label,
  allowed,
  enabled,
  saving,
  disabled,
  onToggle,
  lockedReason,
}: {
  label: string;
  allowed: boolean;
  enabled: boolean;
  saving: boolean;
  disabled: boolean;
  onToggle: (next: boolean) => void;
  // When set, the toggle is forced off and non-interactive (e.g. temporarily disabled).
  lockedReason?: string;
}) => {
  const locked = Boolean(lockedReason);
  // A method can only be interacted with when PayPal allows it and it is not locked.
  const interactive = allowed && !disabled && !locked;
  const isOn = allowed && enabled && !locked;

  const handleClick = () => {
    if (!interactive) return;
    onToggle(!isOn);
  };

  return (
    <Box
      paddingX={4}
      paddingY={3}
      borderRadius={4}
      borderWidth={1}
      borderColor={isOn ? "success1" : "default1"}
      __backgroundColor={isOn ? "#F0FDFA" : "#F9FAFB"}
      display="flex"
      alignItems="center"
      justifyContent="space-between"
    >
      <Box display="flex" flexDirection="column" gap={1}>
        <Text size={3} fontWeight="medium" __color={allowed && !locked ? "#374151" : "#9CA3AF"}>
          {label}
        </Text>
        {locked ? (
          <Text size={1} __color="#9CA3AF">
            {lockedReason}
          </Text>
        ) : (
          !allowed && (
            <Text size={1} __color="#9CA3AF">
              Not available on your PayPal account
            </Text>
          )
        )}
      </Box>

      {/* Toggle switch */}
      <Box
        onClick={handleClick}
        __width="44px"
        __height="24px"
        __minWidth="44px"
        __borderRadius="9999px"
        __backgroundColor={isOn ? "#10B981" : "#D1D5DB"}
        __cursor={interactive ? "pointer" : "not-allowed"}
        __opacity={!allowed || locked || saving ? "0.5" : "1"}
        __transition="background-color 0.2s"
        display="flex"
        alignItems="center"
        title={
          locked
            ? lockedReason
            : !allowed
              ? "Not available on your PayPal account"
              : isOn
                ? "Enabled \u2014 click to disable"
                : "Disabled \u2014 click to enable"
        }
      >
        <Box
          __width="18px"
          __height="18px"
          __borderRadius="50%"
          __backgroundColor="#FFFFFF"
          __transition="margin 0.2s"
          __marginLeft={isOn ? "23px" : "3px"}
        />
      </Box>
    </Box>
  );
};
