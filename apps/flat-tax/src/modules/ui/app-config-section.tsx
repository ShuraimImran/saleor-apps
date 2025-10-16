import { Box, Text } from "@saleor/macaw-ui";
import * as React from "react";

export const AppConfigSection = () => {
  return (
    <Box display="flex" flexDirection="column" gap={4}>
      <Box>
        <Text size={4} fontWeight="bold">App Configuration</Text>
        <Text color="default2">Configure general app settings and fallback behavior</Text>
      </Box>
      
      <Box padding={4} borderStyle="solid" borderWidth={1} borderColor="default1" borderRadius={4}>
        <Text>Configuration form will be implemented here.</Text>
      </Box>
    </Box>
  );
};
