import { Layout } from "@saleor/apps-ui";
import { Box, Button, Input,Text } from "@saleor/macaw-ui";
import { NextPage } from "next";
import { useEffect,useState } from "react";

import { trpcClient } from "@/modules/trpc/trpc-client";

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

const ConfigRow = ({ label, value }: { label: string; value: string }) => (
  <Box
    display="flex"
    alignItems="center"
    paddingX={4}
    paddingY={3}
    borderBottomWidth={1}
    borderColor="default1"
  >
    <Box __width="160px" __minWidth="160px">
      <Text size={2} __color="#6B7280">{label}:</Text>
    </Box>
    <Box __flex="1" __overflow="hidden">
      <Text size={2} fontWeight="medium" __wordBreak="break-all">{value}</Text>
    </Box>
  </Box>
);

const WebhookRow = ({ webhookId }: { webhookId: string }) => {
  const [showFull, setShowFull] = useState(false);

  return (
    <Box
      display="flex"
      alignItems="center"
      paddingX={4}
      paddingY={3}
      borderBottomWidth={1}
      borderColor="default1"
    >
      <Box __width="160px" __minWidth="160px">
        <Text size={2} __color="#6B7280">Webhook:</Text>
      </Box>
      <Box __flex="1" __overflow="hidden">
        <Text size={2} fontWeight="medium" __wordBreak="break-all">
          {showFull ? webhookId : `***${webhookId.slice(-4)}`}
        </Text>
      </Box>
      <Box
        __cursor="pointer"
        paddingX={2}
        onClick={() => setShowFull((v) => !v)}
      >
        <Text size={2} __color="#6B7280">{showFull ? "Hide" : "Show"}</Text>
      </Box>
    </Box>
  );
};

const EnvironmentConfigPanel = ({
  environment,
  existingConfig,
  onSaved,
}: {
  environment: PayPalEnvironment;
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
  const [isEditing, setIsEditing] = useState(false);

  const isLive = environment === "LIVE";
  const label = isLive ? "Live (Production) Configuration" : "Sandbox (Test) Configuration";

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
          setIsEditing(false);
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
      setTimeout(() => setMessage(null), 3000);

      return;
    }

    setMessage(null);
    testCredentials({ clientId: form.clientId, clientSecret: form.clientSecret, environment });
  };

  const handleSave = () => {
    if (!form.clientId || !form.clientSecret) {
      setMessage({ type: "error", text: "Please enter Client ID and Client Secret" });
      setTimeout(() => setMessage(null), 3000);

      return;
    }

    setMessage(null);
    saveConfig({
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
      borderRadius={4}
      borderWidth={1}
      borderColor="default1"
      __backgroundColor="#FFFFFF"
      __overflow="hidden"
    >
      {/* Header */}
      <Box
        paddingX={5}
        paddingY={4}
        display="flex"
        justifyContent="space-between"
        alignItems="center"
        borderBottomWidth={1}
        borderColor="default1"
      >
        <Box display="flex" alignItems="center" gap={3}>
          <Text size={4} fontWeight="bold">
            {label}
          </Text>
          {existingConfig ? (
            <Box
              paddingX={3}
              paddingY={1}
              __borderRadius="9999px"
              __backgroundColor="#0D9488"
              display="flex"
              alignItems="center"
              gap={1}
            >
              <Text size={1} fontWeight="bold" __color="#FFFFFF" __lineHeight="1">{"\u2022"}</Text>
              <Text size={1} fontWeight="medium" __color="#FFFFFF" __lineHeight="1">Configured</Text>
            </Box>
          ) : (
            <Box
              paddingX={3}
              paddingY={1}
              __borderRadius="9999px"
              __backgroundColor="#FEE2E2"
            >
              <Text size={1} fontWeight="medium" __color="#991B1B" __lineHeight="1">Not Configured</Text>
            </Box>
          )}
        </Box>
        {!isEditing && (
          <Button
            variant="primary"
            size="small"
            onClick={() => setIsEditing(true)}
          >
            {existingConfig ? "Update Configuration" : "Configure"}
          </Button>
        )}
      </Box>

      {/* Message */}
      {message && (
        <Box
          padding={4}
          borderBottomWidth={1}
          borderColor={message.type === "success" ? "success1" : "critical1"}
          __backgroundColor={message.type === "success" ? "#F0FDF4" : "#FEF2F2"}
        >
          <Text size={2} color={message.type === "success" ? "success1" : "critical1"}>
            {message.text}
          </Text>
        </Box>
      )}

      {/* Current config view */}
      {existingConfig && !isEditing && (
        <Box>
          <Box paddingX={5} paddingY={3} borderBottomWidth={1} borderColor="default1">
            <Text size={1} fontWeight="bold" __color="#6B7280" __letterSpacing="0.05em">
              CURRENT CONFIGURATION
            </Text>
          </Box>

          <Box
            borderWidth={1}
            borderColor="default1"
            __margin="16px 20px"
            borderRadius={4}
            __backgroundColor="#FAFAFA"
          >
            <ConfigRow label="Client ID" value={existingConfig.clientId} />
            <ConfigRow label="Client Secret" value={existingConfig.clientSecret} />
            {existingConfig.partnerMerchantId && (
              <ConfigRow label="Partner Merchant ID" value={existingConfig.partnerMerchantId} />
            )}
            <ConfigRow
              label="Partner Fee"
              value={`${existingConfig.partnerFeePercent ?? 0}%`}
            />
            {existingConfig.bnCode && (
              <ConfigRow label="BN Code" value={existingConfig.bnCode} />
            )}
            {existingConfig.webhookId && (
              <WebhookRow webhookId={existingConfig.webhookId} />
            )}
          </Box>

          <Box paddingX={5} paddingY={3}>
            <Text size={1} __color="#9CA3AF">
              Last updated: {new Date(existingConfig.updatedAt).toLocaleString()}
            </Text>
          </Box>
        </Box>
      )}

      {/* Edit form */}
      {isEditing && (
        <Box padding={5}>
          <Box
            display="flex"
            alignItems="center"
            justifyContent="space-between"
            marginBottom={5}
            borderBottomWidth={1}
            borderColor="default1"
            paddingBottom={3}
          >
            <Text size={1} fontWeight="bold" __color="#6B7280" __letterSpacing="0.05em">
              UPDATE CREDENTIALS
            </Text>
            <Button
              variant="secondary"
              size="small"
              onClick={handleTest}
              disabled={isTestingCredentials || !form.clientId || !form.clientSecret}
            >
              {isTestingCredentials ? "Testing..." : "Test Credentials"}
            </Button>
          </Box>

          <Box display="flex" flexDirection="column" gap={4}>
            <Box>
              <Text size={2} fontWeight="medium" __color="#1E40AF" marginBottom={2}>
                Partner Client ID
              </Text>
              <Input
                type="text"
                value={form.clientId}
                onChange={(e) => setForm((f) => ({ ...f, clientId: e.target.value }))}
                placeholder="Enter partner client ID"
              />
            </Box>

            <Box>
              <Text size={2} fontWeight="medium" __color="#1E40AF" marginBottom={2}>
                Partner Client Secret
              </Text>
              <Input
                type="text"
                value={form.clientSecret}
                onChange={(e) => setForm((f) => ({ ...f, clientSecret: e.target.value }))}
                placeholder="Enter partner client secret"
              />
            </Box>

            <Box>
              <Text size={2} fontWeight="medium" marginBottom={2}>
                Partner Merchant ID <Text size={1} __color="#9CA3AF">(Optional)</Text>
              </Text>
              <Input
                type="text"
                value={form.partnerMerchantId}
                onChange={(e) => setForm((f) => ({ ...f, partnerMerchantId: e.target.value }))}
                placeholder="Enter partner merchant ID"
              />
            </Box>

            <Box>
              <Text size={2} fontWeight="medium" marginBottom={2}>
                Partner Fee Percent <Text size={1} __color="#9CA3AF">(Optional)</Text>
              </Text>
              <Box display="flex" alignItems="center" gap={2}>
                <Box __flex="1">
                  <Input
                    type="number"
                    value={form.partnerFeePercent}
                    onChange={(e) => setForm((f) => ({ ...f, partnerFeePercent: e.target.value }))}
                    placeholder="0.00"
                    min="0"
                    max="100"
                    step="0.01"
                  />
                </Box>
                <Text size={2} color="default2">%</Text>
              </Box>
            </Box>

            <Box>
              <Text size={2} fontWeight="medium" marginBottom={2}>
                BN Code <Text size={1} __color="#9CA3AF">(Optional)</Text>
              </Text>
              <Input
                type="text"
                value={form.bnCode}
                onChange={(e) => setForm((f) => ({ ...f, bnCode: e.target.value }))}
                placeholder="Enter BN code"
              />
            </Box>

            <Box display="flex" gap={3} marginTop={2}>
              <Box __flex="1">
                <Button
                  variant="secondary"
                  onClick={() => {
                    setIsEditing(false);
                    setForm(emptyForm);
                    setMessage(null);
                  }}
                  disabled={isSavingConfig}
                  style={{ width: "100%" }}
                >
                  Cancel
                </Button>
              </Box>
              <Box __flex="1">
                <Button
                  variant="primary"
                  onClick={handleSave}
                  disabled={isTestingCredentials || isSavingConfig || !form.clientId || !form.clientSecret}
                  style={{ width: "100%" }}
                >
                  {isSavingConfig ? "Saving..." : "Save Configuration"}
                </Button>
              </Box>
            </Box>
          </Box>
        </Box>
      )}

      {/* Not configured - show form directly */}
      {!existingConfig && !isEditing && (
        <Box padding={5}>
          <Text size={3} color="default2">
            No configuration found. Click "Configure" to set up {isLive ? "production" : "sandbox"} credentials.
          </Text>
        </Box>
      )}
    </Box>
  );
};

const LoginForm = ({ onLogin }: { onLogin: () => void }) => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleLogin = async () => {
    if (!email || !password) {
      setError("Please enter email and password");

      return;
    }

    setError(null);
    setIsLoading(true);

    try {
      const response = await fetch("/api/wsm-admin/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || "Login failed");
        setTimeout(() => setError(null), 3000);
        setIsLoading(false);

        return;
      }

      onLogin();
    } catch (err) {
      setError("Network error. Please try again.");
      setIsLoading(false);
    }
  };

  return (
    <Box
      display="flex"
      justifyContent="center"
      alignItems="center"
      style={{ height: "100vh", overflow: "hidden" }}
      __backgroundColor="#F8FAFC"
    >
      <Box
        padding={8}
        borderRadius={4}
        borderWidth={1}
        borderColor="default1"
        __backgroundColor="#FFFFFF"
        __maxWidth="420px"
        __width="100%"
        display="flex"
        flexDirection="column"
        gap={5}
      >
        <Box display="flex" flexDirection="column" alignItems="center" gap={2}>
          <Text size={6} fontWeight="bold">WSM PayPal Administrative Panel</Text>
          <Text size={3} color="default2">Sign in to manage PayPal configuration</Text>
        </Box>

        {error && (
          <Box
            padding={3}
            borderRadius={4}
            __backgroundColor="#FEF2F2"
            borderWidth={1}
            borderColor="critical1"
            display="flex"
            alignItems="center"
            gap={2}
          >
            <Text size={2} color="critical1">{error}</Text>
          </Box>
        )}

        <Box display="flex" flexDirection="column" gap={2}>
          <Text size={2} fontWeight="medium">Email</Text>
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyPress={(e) => {
              if (e.key === "Enter") handleLogin();
            }}
            placeholder="admin@example.com"
            disabled={isLoading}
          />
        </Box>

        <Box display="flex" flexDirection="column" gap={2}>
          <Text size={2} fontWeight="medium">Password</Text>
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyPress={(e) => {
              if (e.key === "Enter") handleLogin();
            }}
            placeholder="Enter your password"
            disabled={isLoading}
          />
        </Box>

        <Button
          variant="primary"
          onClick={handleLogin}
          disabled={isLoading || !email || !password}
          style={{ width: "100%" }}
        >
          {isLoading ? "Signing in..." : "Sign In"}
        </Button>

        <Text size={1} color="default2" style={{ textAlign: "center" }}>
          Session expires after 15 minutes of inactivity
        </Text>
      </Box>
    </Box>
  );
};

const WsmAdminPage: NextPage = () => {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [adminEmail, setAdminEmail] = useState("");

  // Check existing session on load
  useEffect(() => {
    const checkSession = async () => {
      try {
        const response = await fetch("/api/wsm-admin/auth");
        const data = await response.json();

        if (data.authenticated) {
          setIsAuthenticated(true);
          setAdminEmail(data.email);
        } else {
          setIsAuthenticated(false);
        }
      } catch {
        setIsAuthenticated(false);
      }
    };

    checkSession();
  }, []);

  const handleLogout = async () => {
    await fetch("/api/wsm-admin/auth", { method: "DELETE" });
    setIsAuthenticated(false);
    setAdminEmail("");
  };

  // Query global config (only when authenticated)
  const {
    data: configData,
    refetch: refetchConfig,
    isLoading: isLoadingConfig,
  } = trpcClient.wsmAdmin.getGlobalConfig.useQuery(
    undefined,
    {
      enabled: isAuthenticated === true,
      retry: false,
    }
  );

  if (isAuthenticated === null) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" style={{ minHeight: "100vh" }}>
        <Text size={4} color="default2">Loading...</Text>
      </Box>
    );
  }

  if (!isAuthenticated) {
    return (
      <LoginForm
        onLogin={() => {
          setIsAuthenticated(true);
        }}
      />
    );
  }

  if (isLoadingConfig) {
    return (
      <Box padding={8}>
        <Text size={5} fontWeight="bold">Loading configuration...</Text>
      </Box>
    );
  }

  return (
    <Box>
      {/* Custom header with logout */}
      <Box
        marginBottom={12}
        paddingBottom={8}
        borderBottomWidth={1}
        borderColor="default1"
      >
        <Box display="flex" justifyContent="space-between" alignItems="center">
          <Text as="h1" size={10} fontWeight="bold" __color="#1a1a1a">
            PayPal Payment Configuration
          </Text>
          <Box display="flex" alignItems="center" gap={3}>
            <Text size={2} color="default2">{adminEmail}</Text>
            <Button size="small" variant="secondary" onClick={handleLogout}>
              Logout
            </Button>
          </Box>
        </Box>
        <Text size={3} color="default2" marginTop={3}>
          Configure your PayPal integration to start accepting payments.
        </Text>
      </Box>
      <Layout.AppSection
        marginBottom={8}
        heading="PayPal App related Tenant Management"
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
        <TenantManagementSection />
      </Layout.AppSection>
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
            existingConfig={configData?.sandboxConfig ?? null}
            onSaved={() => refetchConfig()}
          />
          <EnvironmentConfigPanel
            environment="LIVE"
            existingConfig={configData?.liveConfig ?? null}
            onSaved={() => refetchConfig()}
          />
        </Box>
      </Layout.AppSection>
    </Box>
  );
};

const TenantManagementSection = () => {
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
    { search: search || undefined, filter, page, pageSize },
    { retry: false, keepPreviousData: true }
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
              isUpdating={isUpdating}
              onToggleLive={() => {
                if (tenant.liveEnabled) {
                  // Try disabling — will return ACTIVE_LIVE_MERCHANT if merchant exists
                  setConfirmDisable(tenant.saleorApiUrl);
                  setLiveAccess({
                                      saleorApiUrl: tenant.saleorApiUrl,
                    liveEnabled: false,
                  });
                } else {
                  setLiveAccess({
                                      saleorApiUrl: tenant.saleorApiUrl,
                    liveEnabled: true,
                  });
                }
              }}
              onSaveFee={(fee) =>
                setTenantFee({
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
