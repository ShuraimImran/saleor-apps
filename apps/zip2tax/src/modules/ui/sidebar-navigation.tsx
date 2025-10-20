import { Box, Text } from "@saleor/macaw-ui";
import Link from "next/link";
import { useRouter } from "next/router";
import * as React from "react";

interface NavigationItem {
  label: string;
  href: string;
  icon?: React.ReactNode;
}

interface SidebarNavigationProps {
  items: NavigationItem[];
}

export const SidebarNavigation: React.FC<SidebarNavigationProps> = ({ items }) => {
  const router = useRouter();
  return (
    <Box
      padding={4}
      style={{ 
        minHeight: "100vh",
        borderRight: "1px solid #e0e0e0"
      }}
    >
      <Box marginBottom={6}>
        <Text size={5} fontWeight="bold">
          Flat Tax App
        </Text>
      </Box>
      
      <Box display="flex" flexDirection="column" gap={2}>
        {items.map((item) => {
          const isActive = router.pathname === item.href;
          
          return (
            <Link key={item.href} href={item.href} style={{ textDecoration: "none" }}>
              <Box
                padding={3}
                style={{
                  backgroundColor: isActive ? "#f0f0f0" : "transparent",
                  cursor: "pointer",
                  borderRadius: "4px",
                }}
              >
                <Box display="flex" alignItems="center" gap={2}>
                  {item.icon}
                  <Text 
                    size={3} 
                    fontWeight={isActive ? "medium" : "regular"}
                    color={isActive ? "default1" : "default2"}
                  >
                    {item.label}
                  </Text>
                </Box>
              </Box>
            </Link>
          );
        })}
      </Box>
    </Box>
  );
};
