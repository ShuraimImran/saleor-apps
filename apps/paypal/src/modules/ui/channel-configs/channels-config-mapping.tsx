import { Layout } from "@saleor/apps-ui";
import { Box, Button, Input, Select, Text } from "@saleor/macaw-ui";
import React from "react";

import { ChannelFragment } from "@/generated/graphql";
import { PayPalFrontendConfigSerializedFields } from "@/modules/app-config/domain/paypal-config";

type PayPalEnvironment = "SANDBOX" | "LIVE";

type Props = {
  channels: ChannelFragment[];
  configs: PayPalFrontendConfigSerializedFields[];
  mapping: Record<string, PayPalFrontendConfigSerializedFields>;
  onMappingChange(data: { channelId: string; configId: string }): void;
  softDescriptor: string;
  onSoftDescriptorChange(value: string): void;
  onSoftDescriptorBlur(): void;
  environment: PayPalEnvironment;
  onEnvironmentChange(value: PayPalEnvironment): void;
  isLoading: boolean;
};

const emptyValue = { value: "", label: "Not assigned" };

export const ChannelsConfigMapping = ({
  channels,
  configs,
  mapping,
  onMappingChange,
  softDescriptor,
  onSoftDescriptorChange,
  onSoftDescriptorBlur,
  environment,
  onEnvironmentChange,
  isLoading,
}: Props) => {
  return (
    <Layout.AppSectionCard>
      <Box>
        <Box paddingBottom={4} borderBottomWidth={1} borderColor="default1">
          <Text size={3} fontWeight="medium" marginBottom={2}>
            PayPal Environment
          </Text>
          <Box display="flex" gap={2} alignItems="center">
            <Button
              size="small"
              variant={environment === "SANDBOX" ? "primary" : "secondary"}
              onClick={() => onEnvironmentChange("SANDBOX")}
              disabled={isLoading}
            >
              Sandbox
            </Button>
            <Button
              size="small"
              variant={environment === "LIVE" ? "primary" : "secondary"}
              onClick={() => onEnvironmentChange("LIVE")}
              disabled={isLoading}
            >
              Live
            </Button>
            <Box
              paddingX={2}
              paddingY={1}
              borderRadius={4}
              __backgroundColor={environment === "LIVE" ? "#D1FAE5" : "#FEF3C7"}
            >
              <Text size={2} fontWeight="medium">
                {environment === "LIVE" ? "Production" : "Test Mode"}
              </Text>
            </Box>
          </Box>
          <Text size={2} color="default2" marginTop={1}>
            Select which PayPal environment this tenant uses. Changing environment requires merchants to re-onboard.
          </Text>
        </Box>

        <Box paddingBottom={4} paddingTop={4} borderBottomWidth={1} borderColor="default1">
          <Text size={3} fontWeight="medium" marginBottom={2}>
            Soft Descriptor
          </Text>
          <Input
            disabled={isLoading}
            value={softDescriptor}
            maxLength={22}
            placeholder="Max 22 characters"
            onChange={(event) => onSoftDescriptorChange(event.target.value)}
            onBlur={onSoftDescriptorBlur}
          />
          <Text size={2} color="default2" marginTop={1}>
            Max 22 characters. Appears on buyer's card statement.
          </Text>
        </Box>
        {channels.map((channel) => {
          const isNotSelected = mapping[channel.id] === undefined;

          const options = configs.map((item) => ({
            value: item.id,
            label: item.name,
          }));

          if (isNotSelected) {
            options.unshift(emptyValue);
          }

          return (
            <Box paddingY={2} key={channel.id} display="flex" justifyContent="space-between">
              <Text>{channel.slug}</Text>
              <Box __minWidth="200px">
                <Select
                  disabled={isLoading}
                  value={mapping[channel.id]?.id ?? ""}
                  onChange={(value) => {
                    onMappingChange({
                      configId: value,
                      channelId: channel.id,
                    });
                  }}
                  options={options}
                />
              </Box>
            </Box>
          );
        })}
      </Box>
    </Layout.AppSectionCard>
  );
};
