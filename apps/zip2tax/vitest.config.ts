import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    workspace: [
      {
        extends: true,
        test: {
          name: "units",
          exclude: ["e2e/**/*.spec.ts"],
          environment: "jsdom",
        },
      },
      {
        test: {
          include: ["e2e/**/*.spec.ts"],
          setupFiles: ["./e2e/setup.ts"],
          name: "e2e",
          environment: "node",
          testTimeout: 63_000,
          retry: 3,
        },
      },
    ],
  },
});