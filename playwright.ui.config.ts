import { defineConfig } from "@playwright/test";

/**
 * Playwright config for browser-level UI navigation tests.
 *
 * Requires the app to be built first: `pnpm build`
 * The test server starts in non-devMode and serves the built React SPA.
 *
 * Run: pnpm test:e2e:ui
 */
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.ui.spec.ts",
  timeout: 30_000,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",

  use: {
    baseURL: "http://127.0.0.1:3999",
    // Headless in CI, headed locally for easier debugging
    headless: true,
  },

  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],

  webServer: {
    command: "tsx tests/e2e/test-server-full.ts",
    url: "http://127.0.0.1:3999",
    reuseExistingServer: !process.env.CI,
    timeout: 20_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
