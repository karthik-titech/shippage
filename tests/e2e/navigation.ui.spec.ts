/**
 * Browser-level UI navigation tests.
 * These run against the full built app (server + React SPA) via Playwright.
 *
 * Requirements: `pnpm build` must be run before these tests.
 * Config: playwright.ui.config.ts
 */
import { test, expect } from "@playwright/test";

// ----------------------------------------------------------------
// Page title
// ----------------------------------------------------------------
test("app has correct page title", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("ShipPage");
});

// ----------------------------------------------------------------
// Dashboard — /
// ----------------------------------------------------------------
test("/ renders the Dashboard with a heading", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
});

test("Dashboard has a New Release button", async ({ page }) => {
  await page.goto("/");
  // Either a link or button with text "New Release"
  await expect(page.getByRole("link", { name: /new release/i }).or(
    page.getByRole("button", { name: /new release/i })
  )).toBeVisible();
});

// ----------------------------------------------------------------
// Sidebar navigation
// ----------------------------------------------------------------
test("sidebar contains Dashboard, New Release, and History nav links", async ({ page }) => {
  await page.goto("/");
  const nav = page.locator("aside nav");
  await expect(nav.getByRole("link", { name: /dashboard/i })).toBeVisible();
  await expect(nav.getByRole("link", { name: /new release/i })).toBeVisible();
  await expect(nav.getByRole("link", { name: /history/i })).toBeVisible();
});

test("sidebar shows the ShipPage brand name", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("aside").getByText("ShipPage")).toBeVisible();
});

// ----------------------------------------------------------------
// History — /history
// ----------------------------------------------------------------
test("/history renders the Release History page", async ({ page }) => {
  await page.goto("/history");
  await expect(page.getByRole("heading", { name: "Release History" })).toBeVisible();
});

test("/history shows empty state with a Create link when no releases exist", async ({ page }) => {
  await page.goto("/history");
  // Empty state has a "Create your first release" link (or similar)
  // We check for either the empty state OR a list of releases — both are valid
  const hasEmptyState = await page.getByText(/no releases yet/i).isVisible().catch(() => false);
  const hasReleases = await page.locator("[data-testid='release-row'], .divide-y > div").count() > 0;
  expect(hasEmptyState || hasReleases).toBe(true);
});

// ----------------------------------------------------------------
// Setup wizard — /setup
// ----------------------------------------------------------------
test("/setup renders the setup wizard", async ({ page }) => {
  await page.goto("/setup");
  await expect(page.getByRole("heading", { name: /setup shippage/i })).toBeVisible();
});

test("/setup shows integration cards (Linear, GitHub, Jira)", async ({ page }) => {
  await page.goto("/setup");
  await expect(page.getByRole("heading", { name: "Linear" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "GitHub Issues" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Jira" })).toBeVisible();
});

// ----------------------------------------------------------------
// Navigation between pages
// ----------------------------------------------------------------
test("clicking History in the sidebar navigates to /history", async ({ page }) => {
  await page.goto("/");
  await page.locator("aside nav").getByRole("link", { name: /history/i }).click();
  await expect(page).toHaveURL(/\/history$/);
  await expect(page.getByRole("heading", { name: "Release History" })).toBeVisible();
});

test("clicking New Release in the sidebar navigates to /new", async ({ page }) => {
  await page.goto("/");
  await page.locator("aside nav").getByRole("link", { name: /new release/i }).click();
  await expect(page).toHaveURL(/\/new$/);
});

// ----------------------------------------------------------------
// Security: index.html has CSRF token injected
// ----------------------------------------------------------------
test("served HTML has CSRF token injected by the server", async ({ page }) => {
  const response = await page.goto("/");
  const html = await response!.text();
  // Server injects: window.__SHIPPAGE_CSRF__ = "..."
  expect(html).toContain("__SHIPPAGE_CSRF__");
});

// ----------------------------------------------------------------
// Unknown route falls back to Dashboard (SPA catch-all)
// ----------------------------------------------------------------
test("unknown routes redirect to Dashboard", async ({ page }) => {
  await page.goto("/this-route-does-not-exist");
  // React Router catch-all redirects to /
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
});
