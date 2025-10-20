import { Box } from "@saleor/macaw-ui";
import React, { useState } from "react";
import { SidebarNavigation } from "./sidebar-navigation";

interface AppLayoutProps {
  children: React.ReactNode;
  activeSection?: string;
  onSectionChange?: (section: string) => void;
}

export const AppLayout: React.FC<AppLayoutProps> = ({ 
  children, 
  activeSection = "tax-settings", 
  onSectionChange 
}) => {
  const [activeNavItem, setActiveNavItem] = useState(activeSection);
  
  React.useEffect(() => {
    setActiveNavItem(activeSection);
  }, [activeSection]);

  const handleNavChange = (itemId: string) => {
    setActiveNavItem(itemId);
    if (onSectionChange) {
      onSectionChange(itemId);
    }
  };

  const navigationItems = [
    { label: "Tax Rates", href: "/configuration" },
    { label: "Configuration", href: "/app-config" },
    { label: "Dashboard", href: "/" },
  ];

  return (
    <Box display="flex" style={{ minHeight: "100vh" }}>
      <SidebarNavigation items={navigationItems} />
      <Box style={{ flex: 1 }} padding={6}>
        {children}
      </Box>
    </Box>
  );
};