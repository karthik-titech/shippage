import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    exclude: ["tests/e2e/**"],
    alias: {
      "@shared": path.resolve(__dirname, "src/shared"),
    },
    // Each test file runs in its own isolated environment
    // to prevent state leakage between tests
    isolate: true,
    // Timeout for individual tests
    testTimeout: 15_000,
  },
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "src/shared"),
    },
  },
});
