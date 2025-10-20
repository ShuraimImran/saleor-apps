import { Box, Text, Button, Input } from "@saleor/macaw-ui";
import { NextPage } from "next";
import * as React from "react";
import { trpcClient } from "@/modules/trpc/trpc-client";

const ConfigurationPage: NextPage = () => {
  // Form state for API credentials
  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [showPassword, setShowPassword] = React.useState(false);
  const [cacheTTLMinutes, setCacheTTLMinutes] = React.useState(15);
  const [metadataTTLDays, setMetadataTTLDays] = React.useState(30);
  const [saveMessage, setSaveMessage] = React.useState("");

  // Manual lookup state
  const [zipInput, setZipInput] = React.useState("");
  const [lookupResult, setLookupResult] = React.useState<{
    zip: string;
    taxRate: number;
    cached: boolean;
  } | null>(null);
  const [lookupError, setLookupError] = React.useState("");

  // Fetch app config
  const { data: appConfig, refetch: refetchConfig } = trpcClient.appConfig.getConfig.useQuery();

  // Fetch cache stats
  const { data: cacheStats, refetch: refetchStats } = trpcClient.taxLookups.getCacheStats.useQuery();

  // Update config mutation
  const updateConfigMutation = trpcClient.appConfig.updateConfig.useMutation({
    onSuccess: () => {
      setSaveMessage("Configuration saved successfully!");
      refetchConfig();
      setTimeout(() => setSaveMessage(""), 3000);
    },
    onError: (error) => {
      setSaveMessage(`Error: ${error.message}`);
      setTimeout(() => setSaveMessage(""), 5000);
    },
  });

  // Manual lookup mutation
  const manualLookupMutation = trpcClient.taxLookups.manualLookup.useMutation({
    onSuccess: (data) => {
      setLookupResult(data);
      setLookupError("");
      refetchStats();
    },
    onError: (error) => {
      setLookupError(error.message);
      setLookupResult(null);
    },
  });

  // Clear cache mutation
  const clearCacheMutation = trpcClient.taxLookups.clearCache.useMutation({
    onSuccess: () => {
      alert("Cache cleared successfully!");
      refetchStats();
    },
    onError: (error) => {
      alert(`Failed to clear cache: ${error.message}`);
    },
  });

  // Load config into form when available
  React.useEffect(() => {
    if (appConfig) {
      setUsername(appConfig.zip2taxUsername || "");
      setPassword(appConfig.zip2taxPassword || "");
      setCacheTTLMinutes(appConfig.cacheTTLMinutes || 15);
      setMetadataTTLDays(appConfig.metadataTTLDays || 30);
    }
  }, [appConfig]);

  const handleSaveConfig = async () => {
    try {
      await updateConfigMutation.mutateAsync({
        zip2taxUsername: username,
        zip2taxPassword: password,
        cacheTTLMinutes,
        metadataTTLDays,
      });
    } catch (error) {
      console.error("Failed to save config:", error);
    }
  };

  const handleManualLookup = async () => {
    if (!zipInput.trim()) {
      setLookupError("Please enter a ZIP code");
      return;
    }

    setLookupError("");
    setLookupResult(null);

    try {
      await manualLookupMutation.mutateAsync({ zip: zipInput.trim() });
    } catch (error) {
      console.error("Lookup failed:", error);
    }
  };

  const handleClearCache = async () => {
    if (confirm("Are you sure you want to clear all cached tax lookups?")) {
      try {
        await clearCacheMutation.mutateAsync();
      } catch (error) {
        console.error("Failed to clear cache:", error);
      }
    }
  };

  return (
    <Box padding={8} style={{ maxWidth: "800px", margin: "0 auto" }}>
      {/* Header */}
      <Box marginBottom={8}>
        <Text size={7} fontWeight="bold" marginBottom={2}>
          Zip2Tax Configuration
        </Text>
        <Text size={3} color="default2">
          Configure your Zip2Tax API credentials and test tax rate lookups.
        </Text>
      </Box>

      {/* API Credentials Section */}
      <Box
        padding={8}
        borderStyle="solid"
        borderWidth={1}
        borderColor="default1"
        borderRadius={4}
        backgroundColor="default1"
        marginBottom={6}
      >
        <Text size={5} fontWeight="bold" marginBottom={4}>
          API Credentials
        </Text>

        {/* Username */}
        <Box marginBottom={4}>
          <Text size={4} fontWeight="medium" marginBottom={2}>
            Username
          </Text>
          <Box width="100%">
            <Input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter your Zip2Tax username"
            />
          </Box>
        </Box>

        {/* Password */}
        <Box marginBottom={4}>
          <Text size={4} fontWeight="medium" marginBottom={2}>
            Password
          </Text>
          <Box display="flex" alignItems="center" gap={2}>
            <Box style={{ flex: 1 }}>
              <Input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your Zip2Tax password"
              />
            </Box>
            <Button
              variant="secondary"
              size="medium"
              onClick={() => setShowPassword(!showPassword)}
            >
              {showPassword ? "Hide" : "Show"}
            </Button>
          </Box>
        </Box>

        {/* Cache TTL Configuration */}
        <Box marginBottom={4}>
          <Text size={4} fontWeight="medium" marginBottom={3}>
            Cache Configuration
          </Text>
          <Box display="flex" gap={4}>
            <Box style={{ flex: 1 }}>
              <Text size={3} fontWeight="medium" marginBottom={2}>
                Memory Cache TTL (minutes)
              </Text>
              <Input
                type="number"
                value={cacheTTLMinutes.toString()}
                onChange={(e) => setCacheTTLMinutes(Number(e.target.value))}
                min={1}
                max={1440}
              />
              <Text size={2} color="default2" marginTop={1}>
                Fast lookups (1-1440 minutes)
              </Text>
            </Box>
            <Box style={{ flex: 1 }}>
              <Text size={3} fontWeight="medium" marginBottom={2}>
                Metadata Storage TTL (days)
              </Text>
              <Input
                type="number"
                value={metadataTTLDays.toString()}
                onChange={(e) => setMetadataTTLDays(Number(e.target.value))}
                min={1}
                max={90}
              />
              <Text size={2} color="default2" marginTop={1}>
                Persistent storage (1-90 days)
              </Text>
            </Box>
          </Box>
        </Box>

        {/* Save Button */}
        <Box display="flex" gap={3} alignItems="center">
          <Button
            variant="primary"
            size="medium"
            onClick={handleSaveConfig}
            disabled={updateConfigMutation.isLoading || !username || !password}
          >
            {updateConfigMutation.isLoading ? "Saving..." : "Save Credentials"}
          </Button>
          {saveMessage && (
            <Text
              size={3}
              color={saveMessage.startsWith("Error") ? "critical1" : "success1"}
            >
              {saveMessage}
            </Text>
          )}
        </Box>

        <Box marginTop={3}>
          <Text size={2} color="default2">
            Your credentials are encrypted and stored securely in Saleor metadata.
          </Text>
        </Box>
      </Box>

      {/* Manual Lookup Section */}
      <Box
        padding={8}
        borderStyle="solid"
        borderWidth={1}
        borderColor="default1"
        borderRadius={4}
        backgroundColor="default1"
        marginBottom={6}
      >
        <Text size={5} fontWeight="bold" marginBottom={4}>
          Test Tax Rate Lookup
        </Text>

        <Box marginBottom={4}>
          <Text size={4} fontWeight="medium" marginBottom={2}>
            ZIP Code
          </Text>
          <Box display="flex" gap={3} alignItems="flex-start">
            <Box width={48}>
              <Input
                value={zipInput}
                onChange={(e) => setZipInput(e.target.value)}
                placeholder="90210 or 90210-3303"
                onKeyPress={(e) => {
                  if (e.key === "Enter") {
                    handleManualLookup();
                  }
                }}
              />
            </Box>
            <Button
              variant="primary"
              size="medium"
              onClick={handleManualLookup}
              disabled={manualLookupMutation.isLoading || !zipInput.trim()}
            >
              {manualLookupMutation.isLoading ? "Looking up..." : "Lookup"}
            </Button>
          </Box>
          <Text size={2} color="default2" marginTop={2}>
            Enter a 5-digit ZIP code (e.g., 90210) or ZIP+4 (e.g., 90210-3303)
          </Text>
        </Box>

        {/* Lookup Result */}
        {lookupResult && (
          <Box
            padding={4}
            borderStyle="solid"
            borderWidth={1}
            borderColor="success1"
            borderRadius={4}
            backgroundColor="success1"
            marginTop={4}
          >
            <Text size={4} fontWeight="bold" marginBottom={2}>
              Tax Rate Found
            </Text>
            <Text size={3} marginBottom={1}>
              ZIP Code: <strong>{lookupResult.zip}</strong>
            </Text>
            <Text size={3} marginBottom={1}>
              Tax Rate: <strong>{lookupResult.taxRate}%</strong>
            </Text>
            <Text size={2} color="default2">
              Result has been cached for future lookups.
            </Text>
          </Box>
        )}

        {/* Lookup Error */}
        {lookupError && (
          <Box
            padding={4}
            borderStyle="solid"
            borderWidth={1}
            borderColor="critical1"
            borderRadius={4}
            backgroundColor="critical1"
            marginTop={4}
          >
            <Text size={4} fontWeight="bold" marginBottom={2}>
              Lookup Failed
            </Text>
            <Text size={3}>{lookupError}</Text>
          </Box>
        )}
      </Box>

      {/* Cache Statistics Section */}
      <Box
        padding={8}
        borderStyle="solid"
        borderWidth={1}
        borderColor="default1"
        borderRadius={4}
        backgroundColor="default1"
      >
        <Text size={5} fontWeight="bold" marginBottom={4}>
          Cache Statistics
        </Text>

        {cacheStats ? (
          <Box>
            <Box marginBottom={3}>
              <Text size={4} fontWeight="medium" marginBottom={2}>
                Memory Cache
              </Text>
              <Text size={3} color="default2" marginBottom={1}>
                Entries: <strong>{cacheStats.memoryCache.entries}</strong>
              </Text>
              <Text size={3} color="default2">
                TTL: <strong>{cacheStats.memoryCache.ttlMinutes} minutes</strong>
              </Text>
            </Box>

            <Box marginBottom={4}>
              <Text size={4} fontWeight="medium" marginBottom={2}>
                Metadata Storage
              </Text>
              <Text size={3} color="default2">
                Cached Lookups: <strong>{cacheStats.metadataStorage.entries}</strong>
              </Text>
            </Box>

            <Button
              variant="secondary"
              size="medium"
              onClick={handleClearCache}
              disabled={clearCacheMutation.isLoading}
            >
              {clearCacheMutation.isLoading ? "Clearing..." : "Clear All Caches"}
            </Button>

            <Box marginTop={3}>
              <Text size={2} color="default2">
                Clearing caches will force fresh lookups from the Zip2Tax API for all future requests.
              </Text>
            </Box>
          </Box>
        ) : (
          <Text size={3} color="default2">
            Loading cache statistics...
          </Text>
        )}
      </Box>

      {/* Info Section */}
      <Box marginTop={6}>
        <Text size={3} color="default2">
          <strong>How it works:</strong> When a customer checks out, their ZIP code is used to lookup
          the tax rate from Zip2Tax. Results are cached in memory (15 minutes) and metadata storage
          (30 days) to minimize API calls and improve performance.
        </Text>
      </Box>
    </Box>
  );
};

export default ConfigurationPage;
