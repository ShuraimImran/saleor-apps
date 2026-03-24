import { Layout } from "@saleor/apps-ui";
import { Box, Button, Input,Text } from "@saleor/macaw-ui";
import { NextPage } from "next";
import { useRouter } from "next/router";
import { useEffect,useState } from "react";

import { trpcClient } from "@/modules/trpc/trpc-client";
import { AppHeader } from "@/modules/ui/app-header";

type PayPalEnvironment = "SANDBOX" | "LIVE";

interface ConfigFormState {
  clientId: string;
  clientSecret: string;
  partnerMerchantId: string;
  partnerFeePercent: string;
  bnCode: string;
}

const emptyForm: ConfigFormState = {
  clientId: "",
  clientSecret: "",
  partnerMerchantId: "",
  partnerFeePercent: "",
  bnCode: "",
};

const EnvironmentConfigPanel = ({
  environment,
  secretKey,
  existingConfig,
  onSaved,
}: {
  environment: PayPalEnvironment;
  secretKey: string;
  existingConfig: {
    clientId: string;
    clientSecret: string;
    partnerMerchantId: string | null;
    partnerFeePercent: number | null;
    bnCode: string | null;
    webhookId: string | null;
    webhookUrl: string | null;
    updatedAt: string | Date;
  } | null;
  onSaved: () => void;
}) => {
  const [form, setForm] = useState<ConfigFormState>(emptyForm);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const isLive = environment === "LIVE";
  const label = isLive ? "Live (Production)" : "Sandbox (Test)";
  const borderColor = isLive ? "success1" : "default1";

  const { mutate: testCredentials, isLoading: isTestingCredentials } =
    trpcClient.wsmAdmin.testCredentials.useMutation({
      onSuccess: (result) => {
        setMessage({ type: result.success ? "success" : "error", text: result.message });
      },
      onError: (err: any) => {
        setMessage({ type: "error", text: `Test failed: ${err.message}` });
      },
    });

  const { mutate: saveConfig, isLoading: isSavingConfig } =
    trpcClient.wsmAdmin.setGlobalConfig.useMutation({
      onSuccess: (result) => {
        if (result.success) {
          setMessage({ type: "success", text: result.message });
          setForm(emptyForm);
          onSaved();
        }
      },
      onError: (err: any) => {
        setMessage({ type: "error", text: `Save failed: ${err.message}` });
      },
    });

  const handleTest = () => {
    if (!form.clientId || !form.clientSecret) {
      setMessage({ type: "error", text: "Please enter Client ID and Client Secret" });

      return;
    }

    setMessage(null);
    testCredentials({ secretKey, clientId: form.clientId, clientSecret: form.clientSecret, environment });
  };

  const handleSave = () => {
    if (!form.clientId || !form.clientSecret) {
      setMessage({ type: "error", text: "Please enter Client ID and Client Secret" });

      return;
    }

    setMessage(null);
    saveConfig({
      secretKey,
      clientId: form.clientId,
      clientSecret: form.clientSecret,
      partnerMerchantId: form.partnerMerchantId || undefined,
      partnerFeePercent: form.partnerFeePercent ? parseFloat(form.partnerFeePercent) : undefined,
      bnCode: form.bnCode || undefined,
      environment,
    });
  };

  return (
    <Box
      padding={4}
      borderRadius={4}
      borderWidth={1}
      borderColor={borderColor}
      display="flex"
      flexDirection="column"
      gap={4}
    >
      <Box display="flex" justifyContent="space-between" alignItems="center">
        <Text size={4} fontWeight="bold">
          {label}
        </Text>
        {existingConfig ? (
          <Box
            paddingX={2}
            paddingY={1}
            borderRadius={4}
            __backgroundColor={isLive ? "#D1FAE5" : "#FEF3C7"}
          >
            <Text size={2} fontWeight="medium">
              {isLive ? "Configured" : "Configured"}
            </Text>
          </Box>
        ) : (
          <Box paddingX={2} paddingY={1} borderRadius={4} __backgroundColor="#FEE2E2">
            <Text size={2} fontWeight="medium">
              Not Configured
            </Text>
          </Box>
        )}
      </Box>

      {existingConfig && (
        <Box
          padding={3}
          borderRadius={4}
          __backgroundColor={isLive ? "#F0FDF4" : "#FFFBEB"}
        >
          <Box display="flex" flexDirection="column" gap={1}>
            <Text size={2}>
              <strong>Client ID:</strong> {existingConfig.clientId}
            </Text>
            <Text size={2}>
              <strong>Client Secret:</strong> {existingConfig.clientSecret}
            </Text>
            {existingConfig.partnerMerchantId && (
              <Text size={2}>
                <strong>Partner Merchant ID:</strong> {existingConfig.partnerMerchantId}
              </Text>
            )}
            {existingConfig.partnerFeePercent !== null && existingConfig.partnerFeePercent !== undefined && (
              <Text size={2}>
                <strong>Partner Fee:</strong> {existingConfig.partnerFeePercent}%
              </Text>
            )}
            {existingConfig.bnCode && (
              <Text size={2}>
                <strong>BN Code:</strong> {existingConfig.bnCode}
              </Text>
            )}
            {existingConfig.webhookId && (
              <Text size={2}>
                <strong>Webhook:</strong> Registered ({existingConfig.webhookId.slice(0, 12)}...)
              </Text>
            )}
            <Text size={1} color="default2">
              Last updated: {new Date(existingConfig.updatedAt).toLocaleString()}
            </Text>
          </Box>
        </Box>
      )}

      {message && (
        <Box
          padding={3}
          borderRadius={4}
          borderWidth={1}
          borderColor={message.type === "success" ? "success1" : "critical1"}
        >
          <Text size={2} color={message.type === "success" ? "success1" : "critical1"}>
            {message.text}
          </Text>
        </Box>
      )}

      <Text size={3} fontWeight="medium">
        {existingConfig ? "Update" : "Set"} Credentials
      </Text>

      <Box>
        <Text marginBottom={1} size={2}>Partner Client ID</Text>
        <Input
          type="text"
          size="small"
          value={form.clientId}
          onChange={(e) => setForm((f) => ({ ...f, clientId: e.target.value }))}
          placeholder="AYSq3RDGsmBLJE-otTkBtM..."
        />
      </Box>

      <Box>
        <Text marginBottom={1} size={2}>Partner Client Secret</Text>
        <Input
          type="password"
          size="small"
          value={form.clientSecret}
          onChange={(e) => setForm((f) => ({ ...f, clientSecret: e.target.value }))}
          placeholder="EHnHq7t06p..."
        />
      </Box>

      <Box>
        <Text marginBottom={1} size={2}>Partner Merchant ID (Optional)</Text>
        <Input
          type="text"
          size="small"
          value={form.partnerMerchantId}
          onChange={(e) => setForm((f) => ({ ...f, partnerMerchantId: e.target.value }))}
          placeholder="ABCDEFGHIJKLM"
        />
      </Box>

      <Box>
        <Text marginBottom={1} size={2}>Partner Fee Percent (Optional)</Text>
        <Input
          type="number"
          size="small"
          value={form.partnerFeePercent}
          onChange={(e) => setForm((f) => ({ ...f, partnerFeePercent: e.target.value }))}
          placeholder="2.00"
          min="0"
          max="100"
          step="0.01"
        />
      </Box>

      <Box>
        <Text marginBottom={1} size={2}>BN Code (Optional)</Text>
        <Input
          type="text"
          size="small"
          value={form.bnCode}
          onChange={(e) => setForm((f) => ({ ...f, bnCode: e.target.value }))}
          placeholder="YourPartnerName_SP"
        />
      </Box>

      <Box display="flex" gap={2}>
        <Button
          variant="secondary"
          size="small"
          onClick={handleTest}
          disabled={isTestingCredentials || isSavingConfig || !form.clientId || !form.clientSecret}
        >
          {isTestingCredentials ? "Testing..." : "Test Credentials"}
        </Button>
        <Button
          variant="primary"
          size="small"
          onClick={handleSave}
          disabled={isTestingCredentials || isSavingConfig || !form.clientId || !form.clientSecret}
        >
          {isSavingConfig ? "Saving..." : "Save Configuration"}
        </Button>
      </Box>
    </Box>
  );
};

const WsmAdminPage: NextPage = () => {
  const router = useRouter();
  const [secretKey, setSecretKey] = useState("");

  // Get secret key from URL parameter
  useEffect(() => {
    const keyFromUrl = router.query.key as string;

    if (keyFromUrl) {
      setSecretKey(keyFromUrl);
    }
  }, [router.query.key]);

  // Query global config
  const {
    data: configData,
    refetch: refetchConfig,
    isLoading: isLoadingConfig,
    error: configError,
  } = trpcClient.wsmAdmin.getGlobalConfig.useQuery(
    { secretKey },
    {
      enabled: !!secretKey,
      retry: false,
    }
  );

  if (!secretKey) {
    return (
      <Box padding={8}>
        <Text size={5} fontWeight="bold">
          WSM Super Admin
        </Text>
        <Text marginTop={4} color="default2">
          Please provide secret key via URL: /wsm-admin?key=YOUR_SECRET_KEY
        </Text>
      </Box>
    );
  }

  if (isLoadingConfig) {
    return (
      <Box padding={8}>
        <Text size={5} fontWeight="bold">
          Authenticating...
        </Text>
      </Box>
    );
  }

  if (configError) {
    return (
      <Box padding={8}>
        <Text size={5} fontWeight="bold">
          Authentication Failed
        </Text>
        <Text marginTop={4} color="critical1">
          Invalid secret key or server error
        </Text>
      </Box>
    );
  }

  return (
    <Box>
      <AppHeader />
      <Layout.AppSection
        marginBottom={8}
        heading="WSM Global PayPal Configuration"
        sideContent={
          <Box display="flex" flexDirection="column" gap={4}>
            <Text>
              Configure PayPal Partner API credentials for each environment independently.
              Each tenant can be assigned to either Sandbox or Live.
            </Text>
            <Text>
              <strong>Sandbox:</strong> For testing with PayPal sandbox accounts.
            </Text>
            <Text>
              <strong>Live:</strong> For production payments with real PayPal accounts.
            </Text>
          </Box>
        }
      >
        <Box display="flex" flexDirection="column" gap={6}>
          <EnvironmentConfigPanel
            environment="SANDBOX"
            secretKey={secretKey}
            existingConfig={configData?.sandboxConfig ?? null}
            onSaved={() => refetchConfig()}
          />
          <EnvironmentConfigPanel
            environment="LIVE"
            secretKey={secretKey}
            existingConfig={configData?.liveConfig ?? null}
            onSaved={() => refetchConfig()}
          />
        </Box>
      </Layout.AppSection>
      <Layout.AppSection
        marginBottom={8}
        heading="Tenant Management"
        sideContent={
          <Box display="flex" flexDirection="column" gap={4}>
            <Text>
              Manage which tenants have access to Live (production) mode.
              By default, all tenants are restricted to Sandbox only.
            </Text>
            <Text>
              Enable live access for a tenant when they are ready to process real payments.
            </Text>
          </Box>
        }
      >
        <TenantManagementSection secretKey={secretKey} />
      </Layout.AppSection>
    </Box>
  );
};

const TenantManagementSection = ({ secretKey }: { secretKey: string }) => {
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const searchTimeoutRef = { current: null as ReturnType<typeof setTimeout> | null };
  const [filter, setFilter] = useState<"ALL" | "SANDBOX" | "LIVE">("ALL");
  const [page, setPage] = useState(1);
  const [confirmDisable, setConfirmDisable] = useState<string | null>(null); // saleorApiUrl to confirm
  const pageSize = 10;

  const {
    data: tenantsData,
    refetch: refetchTenants,
    isLoading: isLoadingTenants,
  } = trpcClient.wsmAdmin.listTenants.useQuery(
    { secretKey, search: search || undefined, filter, page, pageSize },
    { enabled: !!secretKey, retry: false, keepPreviousData: true }
  );

  const { mutate: setLiveAccess, isLoading: isUpdatingAccess } =
    trpcClient.wsmAdmin.setTenantLiveAccess.useMutation({
      onSuccess: (result) => {
        setMessage({ type: "success", text: result.message });
        setConfirmDisable(null);
        refetchTenants();
      },
      onError: (err: any) => {
        if (err.message === "ACTIVE_LIVE_MERCHANT") {
          // confirmDisable is already set by onToggleLive — show confirmation dialog
        } else {
          setConfirmDisable(null);
          setMessage({ type: "error", text: `Failed: ${err.message}` });
        }
      },
    });

  const { mutate: setTenantFee, isLoading: isUpdatingFee } =
    trpcClient.wsmAdmin.setTenantFee.useMutation({
      onSuccess: (result) => {
        setMessage({ type: "success", text: result.message });
        refetchTenants();
      },
      onError: (err: any) => {
        setMessage({ type: "error", text: `Failed: ${err.message}` });
      },
    });

  const isUpdating = isUpdatingAccess || isUpdatingFee;

  if (isLoadingTenants) {
    return <Text color="default2">Loading tenants...</Text>;
  }

  const tenants = tenantsData?.tenants ?? [];
  const total = tenantsData?.total ?? 0;
  const totalPages = Math.ceil(total / pageSize);

  const handleSearchInputChange = (value: string) => {
    setSearchInput(value);

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    searchTimeoutRef.current = setTimeout(() => {
      setSearch(value);
      setPage(1);
    }, 300);
  };

  return (
    <Box display="flex" flexDirection="column" gap={4}>
      {/* Search bar */}
      <Box
        display="flex"
        gap={2}
        alignItems="center"
      >
        <Box __flex="1">
          <Input
            type="text"
            value={searchInput}
            onChange={(e) => handleSearchInputChange(e.target.value)}
            placeholder="Search tenants by domain..."
          />
        </Box>
        {searchInput && (
          <Button
            size="small"
            variant="tertiary"
            onClick={() => {
              setSearchInput("");
              setSearch("");
              setPage(1);
              if (searchTimeoutRef.current) {
                clearTimeout(searchTimeoutRef.current);
              }
            }}
          >
            Clear
          </Button>
        )}
      </Box>

      {/* Filter tabs and count */}
      <Box display="flex" justifyContent="space-between" alignItems="center">
        <Box
          display="flex"
          __borderRadius="9999px"
          __backgroundColor="#F1F5F9"
          __padding="3px"
        >
          {(["ALL", "SANDBOX", "LIVE"] as const).map((f) => (
            <Box
              key={f}
              paddingX={4}
              paddingY={1}
              __borderRadius="9999px"
              __backgroundColor={filter === f ? "#1E293B" : "transparent"}
              __cursor="pointer"
              __transition="background-color 0.2s"
              display="flex"
              alignItems="center"
              justifyContent="center"
              onClick={() => {
                setFilter(f);
                setPage(1);
              }}
            >
              <Text
                size={2}
                fontWeight="bold"
                __color={filter === f ? "#FFFFFF" : "#64748B"}
              >
                {f === "ALL" ? "All" : f === "SANDBOX" ? "Sandbox" : "Live"}
              </Text>
            </Box>
        ))}
        </Box>
        {total > 0 && (
          <Box
            paddingX={3}
            paddingY={1}
            __borderRadius="9999px"
            borderWidth={1}
            borderColor="default1"
          >
            <Text size={2} color="default2">
              Showing {(page - 1) * pageSize + 1}-{Math.min(page * pageSize, total)} of {total} tenants
            </Text>
          </Box>
        )}
      </Box>

      {/* Confirmation dialog for disabling live with active merchant */}
      {confirmDisable && (
        <Box
          padding={4}
          borderRadius={4}
          borderWidth={1}
          borderColor="warning1"
          __backgroundColor="#FFFBEB"
          display="flex"
          flexDirection="column"
          gap={3}
        >
          <Text size={3} fontWeight="bold" color="warning1">
            Active Production Merchant Detected
          </Text>
          <Text size={2} color="default2">
            This tenant has an active production merchant connected. Disabling live access will
            disconnect the merchant and switch the tenant to Sandbox mode. This action cannot be undone.
          </Text>
          <Box display="flex" gap={2}>
            <Button
              size="small"
              variant="primary"
              onClick={() => {
                setLiveAccess({
                  secretKey,
                  saleorApiUrl: confirmDisable,
                  liveEnabled: false,
                  force: true,
                });
              }}
              disabled={isUpdatingAccess}
            >
              {isUpdatingAccess ? "Disabling..." : "Confirm Disable Live"}
            </Button>
            <Button
              size="small"
              variant="tertiary"
              onClick={() => setConfirmDisable(null)}
              disabled={isUpdatingAccess}
            >
              Cancel
            </Button>
          </Box>
        </Box>
      )}

      {message && (
        <Box
          padding={3}
          borderRadius={4}
          borderWidth={1}
          borderColor={message.type === "success" ? "success1" : "critical1"}
        >
          <Text size={2} color={message.type === "success" ? "success1" : "critical1"}>
            {message.text}
          </Text>
        </Box>
      )}

      {isLoadingTenants && tenants.length === 0 ? (
        <Text color="default2">Loading tenants...</Text>
      ) : tenants.length === 0 && !isLoadingTenants ? (
        <Box padding={4} borderRadius={4} borderWidth={1} borderColor="default1">
          <Text color="default2">
            {search
              ? `No tenants found matching "${search}".`
              : "No tenants found. Tenants will appear here once they install the PayPal app."}
          </Text>
        </Box>
      ) : (
        <>
          {tenants.map((tenant) => (
            <TenantRow
              key={tenant.saleorApiUrl}
              tenant={tenant}
              secretKey={secretKey}
              isUpdating={isUpdating}
              onToggleLive={() => {
                if (tenant.liveEnabled) {
                  // Try disabling — will return ACTIVE_LIVE_MERCHANT if merchant exists
                  setConfirmDisable(tenant.saleorApiUrl);
                  setLiveAccess({
                    secretKey,
                    saleorApiUrl: tenant.saleorApiUrl,
                    liveEnabled: false,
                  });
                } else {
                  setLiveAccess({
                    secretKey,
                    saleorApiUrl: tenant.saleorApiUrl,
                    liveEnabled: true,
                  });
                }
              }}
              onSaveFee={(fee) =>
                setTenantFee({
                  secretKey,
                  saleorApiUrl: tenant.saleorApiUrl,
                  partnerFeePercent: fee,
                })
              }
            />
          ))}

          {/* Pagination */}
          {totalPages > 1 && (
            <Box display="flex" justifyContent="space-between" alignItems="center">
              <Button
                size="small"
                variant="secondary"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
              >
                Previous
              </Button>
              <Text size={2} color="default2">
                Page {page} of {totalPages}
              </Text>
              <Button
                size="small"
                variant="secondary"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
              >
                Next
              </Button>
            </Box>
          )}
        </>
      )}
    </Box>
  );
};

const MerchantStatusTag = ({ status, environment }: { status: string; environment?: string | null }) => {
  const getConfig = () => {
    switch (status) {
      case "COMPLETED":
        return { bg: "#1E40AF", color: "#FFFFFF", label: `Merchant Connected${environment ? ` (${environment})` : ""}` };
      case "IN_PROGRESS":
        return { bg: "#D97706", color: "#FFFFFF", label: "Merchant Verifying" };
      case "PENDING":
        return { bg: "#D97706", color: "#FFFFFF", label: "Merchant Pending" };
      case "FAILED":
        return { bg: "#DC2626", color: "#FFFFFF", label: "Merchant Failed" };
      default:
        return { bg: "#E5E7EB", color: "#374151", label: "No Merchant" };
    }
  };

  const config = getConfig();

  return (
    <Box
      paddingX={3}
      paddingY={1}
      __borderRadius="9999px"
      __backgroundColor={config.bg}
      display="flex"
      alignItems="center"
      justifyContent="center"
    >
      <Text size={1} fontWeight="medium" __color={config.color} __lineHeight="1">
        {config.label}
      </Text>
    </Box>
  );
};

const LiveAccessTag = ({ liveEnabled }: { liveEnabled: boolean }) => (
  <Box
    paddingX={3}
    paddingY={1}
    __borderRadius="9999px"
    __backgroundColor={liveEnabled ? "#0D9488" : "#F59E0B"}
    display="flex"
    alignItems="center"
    justifyContent="center"
    gap={1}
  >
    {liveEnabled && (
      <Text size={1} fontWeight="bold" __color="#FFFFFF" __lineHeight="1">{"\u2713"}</Text>
    )}
    <Text size={1} fontWeight="medium" __color="#FFFFFF" __lineHeight="1">
      {liveEnabled ? "Live Enabled" : "Sandbox Only"}
    </Text>
  </Box>
);

const TenantRow = ({
  tenant,
  secretKey,
  isUpdating,
  onToggleLive,
  onSaveFee,
}: {
  tenant: {
    saleorApiUrl: string;
    environment: string;
    liveEnabled: boolean;
    partnerFeePercent: number;
    merchantStatus: string;
    merchantEnvironment?: string | null;
  };
  secretKey: string;
  isUpdating: boolean;
  onToggleLive: () => void;
  onSaveFee: (fee: number) => void;
}) => {
  const [feeValue, setFeeValue] = useState(String(tenant.partnerFeePercent ?? 0));

  const tenantName = tenant.saleorApiUrl
    .replace("https://", "")
    .replace("/graphql/", "")
    .replace("/graphql", "");

  const handleFeeBlur = () => {
    const parsed = parseFloat(feeValue);

    if (!isNaN(parsed) && parsed !== tenant.partnerFeePercent) {
      onSaveFee(parsed);
    }
  };

  return (
    <Box
      borderRadius={4}
      borderWidth={1}
      borderColor={tenant.liveEnabled ? "success1" : "default1"}
      __backgroundColor={tenant.liveEnabled ? "#F0FDF4" : "#F9FAFB"}
      __overflow="hidden"
    >
      <Box display="flex">
        {/* Left colored border */}
        <Box
          __width="4px"
          __minWidth="4px"
          __backgroundColor={tenant.liveEnabled ? "#0D9488" : "#E5E7EB"}
        />

        {/* Content */}
        <Box padding={5} __flex="1" display="flex" flexDirection="column" gap={4}>
          {/* Header row: name + button */}
          <Box display="flex" justifyContent="space-between" alignItems="flex-start">
            <Box display="flex" flexDirection="column" gap={2}>
              <Text size={4} fontWeight="bold">
                {tenantName}
              </Text>
              <Box display="flex" gap={2} alignItems="center">
                <Text size={1} fontWeight="medium" __color="#6B7280" __letterSpacing="0.05em">
                  ENVIRONMENT:
                </Text>
                <Box
                  paddingX={2}
                  __borderRadius="9999px"
                  __backgroundColor={tenant.environment === "LIVE" ? "#0D9488" : "#F3F4F6"}
                  borderWidth={1}
                  borderColor={tenant.environment === "LIVE" ? "success1" : "default1"}
                  display="flex"
                  alignItems="center"
                  justifyContent="center"
                  __height="20px"
                >
                  <Text size={1} fontWeight="bold" __color={tenant.environment === "LIVE" ? "#FFFFFF" : "#6B7280"} __lineHeight="1" __fontSize="10px">
                    {tenant.environment}
                  </Text>
                </Box>
              </Box>
            </Box>
            <Button
              size="small"
              variant={tenant.liveEnabled ? "secondary" : "primary"}
              onClick={onToggleLive}
              disabled={isUpdating}
            >
              {tenant.liveEnabled ? "Disable Live" : "Enable Live"}
            </Button>
          </Box>

          {/* Tags row */}
          <Box display="flex" gap={2} alignItems="center" flexWrap="wrap">
            <LiveAccessTag liveEnabled={tenant.liveEnabled} />
            <MerchantStatusTag
              status={tenant.merchantStatus}
              environment={tenant.merchantEnvironment}
            />
          </Box>

          {/* Partner Fee */}
          <Box
            display="flex"
            alignItems="center"
            gap={2}
            paddingX={3}
            paddingY={2}
            borderRadius={4}
            borderWidth={1}
            borderColor="default1"
            __width="fit-content"
          >
            <Text size={2} color="default2" __whiteSpace="nowrap">
              Partner Fee
            </Text>
            <Box __width="60px">
              <Input
                type="number"
                size="small"
                value={feeValue}
                onChange={(e) => setFeeValue(e.target.value)}
                onBlur={handleFeeBlur}
                min="0"
                max="100"
                step="0.01"
                disabled={isUpdating}
              />
            </Box>
            <Text size={2} color="default2">%</Text>
          </Box>
        </Box>
      </Box>
    </Box>
  );
};

export default WsmAdminPage;
