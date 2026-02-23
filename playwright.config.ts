import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.spec.ts",
  timeout: 30_000,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",

  use: {
    baseURL: "http://127.0.0.1:3999",
    extraHTTPHeaders: { Accept: "application/json" },
  },

  webServer: {
    command: "tsx tests/e2e/test-server.ts",
    url: "http://127.0.0.1:3999/api/csrf-token",
    reuseExistingServer: !process.env.CI,
    timeout: 15_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
