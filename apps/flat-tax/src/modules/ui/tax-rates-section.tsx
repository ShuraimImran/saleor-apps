import { Box, Text, Button, Input, Checkbox } from "@saleor/macaw-ui";
import * as React from "react";
import { Select } from "./client-only-select";

export const TaxRatesSection = () => {
  const [mounted, setMounted] = React.useState(false);
  const [country, setCountry] = React.useState("");
  const [state, setState] = React.useState("");
  const [taxRateEnabled, setTaxRateEnabled] = React.useState(false);
  const [postalCode, setPostalCode] = React.useState("");
  const [taxRate, setTaxRate] = React.useState("");

  React.useEffect(() => {
    setMounted(true);
  }, []);

  const handleSaveConfiguration = () => {
    console.log("Saving configuration:", {
      country,
      state,
      taxRateEnabled,
      postalCode,
      taxRate,
    });
    // TODO: Implement actual save functionality
    alert("Configuration saved successfully!");
  };

  if (!mounted) {
    return (
      <Box display="flex" flexDirection="column" gap={6}>
        <Box>
          <Text size={6} fontWeight="bold">Flat Tax Configuration</Text>
          <Text color="default2">Loading...</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box display="flex" flexDirection="column" gap={6}>
      {/* Header */}
      <Box>
        <Text size={6} fontWeight="bold">Flat Tax Configuration</Text>
        <Text color="default2">Configure tax rates and fallback settings for your Saleor store.</Text>
      </Box>

      {/* Main Configuration Form */}
      <Box 
        padding={6} 
        borderStyle="solid" 
        borderWidth={1} 
        borderColor="default1" 
        borderRadius={4}
        backgroundColor="default1"
        display="flex"
        flexDirection="column"
        gap={6}
      >
        {/* 1. Select Country */}
        <Box display="flex" flexDirection="column" gap={3}>
          <Box display="flex" alignItems="center" gap={2}>
            <Box 
              width={6} 
              height={6} 
              backgroundColor="accent1" 
              borderRadius={4}
              display="flex" 
              alignItems="center" 
              justifyContent="center"
            >
              <Text size={1} color="buttonDefaultPrimary" fontWeight="bold">1</Text>
            </Box>
            <Text size={4} fontWeight="bold">Select Country</Text>
          </Box>
          
          <Box suppressHydrationWarning>
            <Select
              value={country}
              onChange={(value: string) => setCountry(value)}
              options={[
                { label: "Select Country", value: "" },
                { label: "United States", value: "US" },
                { label: "Canada", value: "CA" },
                { label: "United Kingdom", value: "UK" },
                { label: "Germany", value: "DE" },
              ]}
            />
          </Box>
        </Box>

        {/* 2. Select State/Province */}
        <Box display="flex" flexDirection="column" gap={3}>
          <Box display="flex" alignItems="center" gap={2}>
            <Box 
              width={6} 
              height={6} 
              backgroundColor="accent1" 
              borderRadius={4}
              display="flex" 
              alignItems="center" 
              justifyContent="center"
            >
              <Text size={1} color="buttonDefaultPrimary" fontWeight="bold">2</Text>
            </Box>
            <Text size={4} fontWeight="bold">Select State/Province</Text>
          </Box>
          
          <Box suppressHydrationWarning>
            <Select
              value={state}
              onChange={(value: string) => setState(value)}
              disabled={!country}
              options={[
                { label: "Select State", value: "" },
                { label: "California", value: "CA" },
                { label: "New York", value: "NY" },
                { label: "Texas", value: "TX" },
                { label: "Florida", value: "FL" },
              ]}
            />
          </Box>
        </Box>

        {/* 3. Enable Tax Rate Toggle */}
        <Box display="flex" flexDirection="column" gap={3}>
          <Box display="flex" alignItems="center" gap={2}>
            <Box 
              width={6} 
              height={6} 
              backgroundColor="accent1" 
              borderRadius={4}
              display="flex" 
              alignItems="center" 
              justifyContent="center"
            >
              <Text size={1} color="buttonDefaultPrimary" fontWeight="bold">3</Text>
            </Box>
            <Text size={4} fontWeight="bold">Enable Tax Rate</Text>
          </Box>
          
          <Box display="flex" alignItems="center" gap={3}>
            <Box width={32}>
              <Input
                value={taxRate}
                onChange={(e) => setTaxRate(e.target.value)}
                placeholder="9.5"
                disabled={!taxRateEnabled}
              />
            </Box>
            <Text size={3}>%</Text>
            <Box>
              <Checkbox
                checked={taxRateEnabled}
                onCheckedChange={(checked) => setTaxRateEnabled(checked === true)}
              />
            </Box>
          </Box>
        </Box>

        {/* 4. Lookup Postal Code-Aware Tax Rate */}
        <Box display="flex" flexDirection="column" gap={3}>
          <Box display="flex" alignItems="center" gap={2}>
            <Box 
              width={6} 
              height={6} 
              backgroundColor="accent1" 
              borderRadius={4}
              display="flex" 
              alignItems="center" 
              justifyContent="center"
            >
              <Text size={1} color="buttonDefaultPrimary" fontWeight="bold">4</Text>
            </Box>
            <Text size={4} fontWeight="bold">Lookup Postal Code-Aware Tax Rate</Text>
          </Box>
          
          <Box display="flex" flexDirection="column" gap={3}>
            <Box>
              <Input
                value={postalCode}
                onChange={(e) => setPostalCode(e.target.value)}
                placeholder="90210"
                disabled={!taxRateEnabled}
              />
            </Box>
            
            <Box display="flex" alignItems="center" gap={3}>
              <Box width={48}>
                <Input
                  placeholder="Tax Rate"
                  disabled={!taxRateEnabled}
                />
              </Box>
              <Text size={3}>%</Text>
            </Box>
          </Box>
        </Box>

        {/* Navigation Links */}
        <Box display="flex" justifyContent="space-between" alignItems="center">
          <Button variant="tertiary" size="medium">
            <Text color="accent1">Review</Text>
          </Button>
          <Button variant="tertiary" size="medium">
            <Text color="accent1">Skip Previous</Text>
          </Button>
        </Box>

        {/* Save Configuration Button */}
        <Button
          variant="primary"
          size="large"
          onClick={handleSaveConfiguration}
          disabled={!country || !state}
        >
          Save Configuration
        </Button>
      </Box>
    </Box>
  );
};
