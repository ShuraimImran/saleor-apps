import { Box, Text, Button, Input } from "@saleor/macaw-ui";
import { NextPage } from "next";
import * as React from "react";
import { useState } from "react";
import { State } from "country-state-city";
import { CreateTaxRateRule, TaxRateRule, SupportedCountry } from "@/modules/tax-rates/tax-rate-schema";
import { trpcClient } from "@/modules/trpc/trpc-client";

const ConfigurationPage: NextPage = () => {
  
  // Form state
  const [formData, setFormData] = React.useState<CreateTaxRateRule>({
    name: "",
    country: "US" as SupportedCountry,
    state: null,
    postalCodePattern: null,
    taxRate: 0,
    enabled: true,
    priority: 100,
  });

  // Keep tax rate as string for better input handling
  const [taxRateInput, setTaxRateInput] = React.useState("");
  
  // UI state
  const [isEditing, setIsEditing] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState<{
    show: boolean;
    rateId: string;
    rateName: string;
  }>({ show: false, rateId: "", rateName: "" });
  
  // tRPC queries and mutations  
  const { data: taxRates = [], refetch, isLoading } = trpcClient.taxRates.getAllRates.useQuery();
  const createMutation = trpcClient.taxRates.createRate.useMutation({
    onSuccess: () => {
      refetch();
      resetForm();
    },
    onError: (error) => {
      console.error("Failed to create tax rate:", error);
      alert("Failed to create tax rate. Please try again.");
    },
  });
  const updateMutation = trpcClient.taxRates.updateRate.useMutation({
    onSuccess: () => {
      refetch();
      resetForm();
    },
    onError: (error) => {
      console.error("Failed to update tax rate:", error);
      alert("Failed to update tax rate. Please try again.");
    },
  });
  const deleteMutation = trpcClient.taxRates.deleteRate.useMutation({
    onSuccess: () => {
      refetch();
    },
    onError: (error) => {
      alert("Failed to delete tax rate. Please try again.");
    },
  });

  const resetForm = () => {
    setFormData({
      name: "",
      country: "US" as SupportedCountry,
      state: null,
      postalCodePattern: null,
      taxRate: 0,
      enabled: true,
      priority: 100,
    });
    setTaxRateInput("");
    setIsEditing(false);
    setEditingId(null);
  };

  const handleEdit = (rate: TaxRateRule) => {
    setFormData({
      name: rate.name,
      country: rate.country,
      state: rate.state,
      postalCodePattern: rate.postalCodePattern,
      taxRate: rate.taxRate,
      enabled: rate.enabled,
      priority: rate.priority,
    });
    setTaxRateInput(rate.taxRate.toString());
    setIsEditing(true);
    setEditingId(rate.id);
  };

  const handleDelete = (id: string) => {
    const rate = taxRates.find(r => r.id === id);
    setDeleteConfirmation({
      show: true,
      rateId: id,
      rateName: rate?.name || "Unknown rate"
    });
  };

  const confirmDelete = async () => {
    try {
      await deleteMutation.mutateAsync({ id: deleteConfirmation.rateId });
      setDeleteConfirmation({ show: false, rateId: "", rateName: "" });
    } catch (error) {
      alert(`Failed to delete tax rate: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const cancelDelete = () => {
    setDeleteConfirmation({ show: false, rateId: "", rateName: "" });
  };

  const handleToggleEnabled = async (rate: TaxRateRule) => {
    try {
      await updateMutation.mutateAsync({
        id: rate.id,
        enabled: !rate.enabled,
      });
    } catch (error) {
      console.error("Failed to toggle tax rate:", error);
      alert("Failed to toggle tax rate. Please try again.");
    }
  };

  // Available countries
  const countries = [
    { name: "United States", isoCode: "US" as SupportedCountry },
    { name: "Canada", isoCode: "CA" as SupportedCountry },
    { name: "Mexico", isoCode: "MX" as SupportedCountry },
  ];

  // Get states for selected country
  const states = formData.country ? State.getStatesOfCountry(formData.country) : [];

  const handleCountryChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setFormData(prev => ({
      ...prev,
      country: e.target.value as SupportedCountry,
      state: null, // Reset state when country changes
    }));
    setTaxRateInput(""); // Clear tax rate input
  };

  const handleStateChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setFormData(prev => ({
      ...prev,
      state: e.target.value || null,
    }));
    setTaxRateInput(""); // Clear tax rate input when state changes
  };

  const handleSaveConfiguration = async () => {
    try {
      const taxRateValue = parseFloat(taxRateInput);

      if (isNaN(taxRateValue) || taxRateValue < 0) {
        alert("Please enter a valid tax rate");
        return;
      }

      const dataToSave = {
        ...formData,
        taxRate: taxRateValue,
      };

      if (isEditing && editingId) {
        // Update existing rate
        await updateMutation.mutateAsync({
          id: editingId,
          ...dataToSave,
        });
        alert("Tax rate updated successfully!");
      } else {
        // Create new rate
        await createMutation.mutateAsync(dataToSave);
        alert("Tax rate created successfully!");
      }
    } catch (error) {
      console.error("Error saving tax rate:", error);
      alert("Failed to save tax rate. Please try again.");
    }
  };

  return (
    <Box padding={8} style={{ maxWidth: "800px", margin: "0 auto" }}>
      {/* DEBUG: Test Button */}
      
      
      {/* Header */}
      <Box marginBottom={8}>
        <Text size={7} fontWeight="bold" marginBottom={2}>
          Flat Tax Configuration
        </Text>
        <Text size={3} color="default2">
          Configure tax rates by country/state and postal codes.
        </Text>
      </Box>

      {/* Main Form */}
      <Box
        padding={8}
        borderStyle="solid"
        borderWidth={1}
        borderColor="default1"
        borderRadius={4}
        backgroundColor="default1"
        display="flex"
        flexDirection="column"
        gap={6}
      >
        {/* Country/State Tax Rates Section */}
        <Box>
          <Text size={5} fontWeight="bold" marginBottom={4}>
            Country & State Tax Rates
          </Text>

          {/* Name Field */}
          <Box display="flex" flexDirection="column" gap={3} marginBottom={4}>
            <Text size={4} fontWeight="medium">
              Rule Name
            </Text>
            <Box width={48}>
              <Input
                value={formData.name}
                onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                placeholder="e.g., California Sales Tax"
              />
            </Box>
          </Box>

          {/* Select Country */}
          <Box display="flex" flexDirection="column" gap={3} marginBottom={4}>
            <Text size={4} fontWeight="medium">
              Select Country
            </Text>
            <select
              value={formData.country}
              onChange={handleCountryChange}
              style={{
                padding: "12px",
                fontSize: "14px",
                borderRadius: "4px",
                border: "1px solid #ccc",
                backgroundColor: "white",
                cursor: "pointer",
              }}
            >
              <option value="">Select Country</option>
              {countries.map((c) => (
                <option key={c.isoCode} value={c.isoCode}>
                  {c.name}
                </option>
              ))}
            </select>
          </Box>

          {/* Select State/Province - Only show when country is selected */}
          {formData.country && (
            <Box display="flex" flexDirection="column" gap={3} marginBottom={4}>
              <Text size={4} fontWeight="medium">
                Select State/Province
              </Text>
              <select
                value={formData.state || ""}
                onChange={handleStateChange}
                style={{
                  padding: "12px",
                  fontSize: "14px",
                  borderRadius: "4px",
                  border: "1px solid #ccc",
                  backgroundColor: "white",
                  cursor: "pointer",
                }}
              >
                <option value="">Select State</option>
                {states.map((s) => (
                  <option key={s.isoCode} value={s.isoCode}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Box>
          )}

          {/* Additional fields - Only show when state is selected */}
          {formData.country && formData.state && (
            <Box display="flex" flexDirection="column" gap={4}>
              {/* Postal Code Pattern (Optional) */}
              <Box display="flex" flexDirection="column" gap={3}>
                <Text size={4} fontWeight="medium">
                  Postal Code Pattern (Optional)
                </Text>
                <Box width={48}>
                  <Input
                    value={formData.postalCodePattern || ""}
                    onChange={(e) => setFormData(prev => ({ ...prev, postalCodePattern: e.target.value || null }))}
                    placeholder="90210 or 90*"
                  />
                </Box>
                <Text size={3} color="default2">
                  Leave empty for country/state-wide rates. Use patterns like "90210" or "90*" for specific postal codes.
                </Text>
              </Box>

              {/* Tax Rate */}
              <Box display="flex" flexDirection="column" gap={3}>
                <Text size={4} fontWeight="medium">
                  Tax Rate (%)
                </Text>
                <Box display="flex" alignItems="center" gap={4}>
                  <Box width={32}>
                    <Input
                      type="number"
                      step="0.01"
                      value={taxRateInput}
                      onChange={(e) => setTaxRateInput(e.target.value)}
                      placeholder="9.5"
                    />
                  </Box>
                  <Text size={3}>%</Text>
                </Box>
                <Text size={2} color="default2">
                  Enter the percentage (e.g., 9.5 for 9.5% tax, or 0.1 for 0.1% tax)
                </Text>
              </Box>

              {/* Action Buttons */}
              <Box display="flex" gap={3}>
                <Button
                  variant="primary"
                  size="medium"
                  onClick={handleSaveConfiguration}
                  disabled={!taxRateInput || !formData.name}
                >
                  {isEditing ? "Update Tax Rate" : "Add Tax Rate"}
                </Button>
                {isEditing && (
                  <Button
                    variant="secondary"
                    size="medium"
                    onClick={resetForm}
                  >
                    Cancel
                  </Button>
                )}
              </Box>
            </Box>
          )}
        </Box>

        {/* Saved Tax Rates Section */}
        <Box marginTop={8}>
          <Text size={5} fontWeight="bold" marginBottom={4}>
            Saved Tax Rates
          </Text>
          
          {isLoading ? (
            <Text>Loading tax rates...</Text>
          ) : taxRates.length === 0 ? (
            <Text color="default2">No tax rates configured yet.</Text>
          ) : (
            <Box display="flex" flexDirection="column" gap={3}>
              {taxRates.map((rate) => (
                <Box
                  key={rate.id}
                  padding={4}
                  borderStyle="solid"
                  borderWidth={1}
                  borderColor="default1"
                  borderRadius={4}
                  backgroundColor="default1"
                  style={{ opacity: rate.enabled ? 1 : 0.6 }}
                >
                  <Box display="flex" justifyContent="space-between" alignItems="flex-start">
                    <Box>
                      <Box display="flex" alignItems="center" gap={2} marginBottom={2}>
                        <Text size={4} fontWeight="medium">
                          {rate.name}
                        </Text>
                        {!rate.enabled && (
                          <Text size={2} color="default2" style={{ fontStyle: "italic" }}>
                            (Disabled)
                          </Text>
                        )}
                      </Box>
                      <Text size={3} color="default2" marginBottom={1}>
                        Country: {rate.country}
                        {rate.state && ` / State: ${rate.state}`}
                        {rate.postalCodePattern && ` / Postal Code: ${rate.postalCodePattern}`}
                      </Text>
                      <Text size={3} color="default2" marginBottom={1}>
                        Tax Rate: {rate.taxRate}%
                      </Text>
                      <Text size={3} color="default2">
                        Priority: {rate.priority}
                      </Text>
                    </Box>
                    <Box display="flex" gap={2} alignItems="center">
                      <Button
                        variant={rate.enabled ? "secondary" : "primary"}
                        size="small"
                        onClick={() => handleToggleEnabled(rate)}
                        disabled={updateMutation.isLoading}
                      >
                        {rate.enabled ? "Disable" : "Enable"}
                      </Button>
                      <Button
                        variant="secondary"
                        size="small"
                        onClick={() => handleEdit(rate)}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="secondary"
                        size="small"
                        onClick={() => handleDelete(rate.id)}
                        disabled={deleteMutation.isLoading}
                      >
                        Delete
                      </Button>
                    </Box>
                  </Box>
                </Box>
              ))}
            </Box>
          )}
        </Box>
      </Box>

      {/* Delete Confirmation Dialog */}
      {deleteConfirmation.show && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0, 0, 0, 0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
        >
          <Box
            backgroundColor="default1"
            padding={6}
            borderRadius={4}
            borderStyle="solid"
            borderWidth={1}
            borderColor="default1"
            style={{ maxWidth: "400px", width: "90%" }}
          >
            <Text size={5} fontWeight="bold" marginBottom={4}>
              Confirm Deletion
            </Text>
            <Text size={3} marginBottom={6}>
              Are you sure you want to delete the tax rate "{deleteConfirmation.rateName}"? This action cannot be undone.
            </Text>
            <Box display="flex" gap={3} justifyContent="flex-end">
              <Button
                variant="secondary"
                onClick={cancelDelete}
                disabled={deleteMutation.isLoading}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={confirmDelete}
                disabled={deleteMutation.isLoading}
              >
                {deleteMutation.isLoading ? "Deleting..." : "Delete"}
              </Button>
            </Box>
          </Box>
        </div>
      )}
    </Box>
  );
};

export default ConfigurationPage;
