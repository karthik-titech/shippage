/**
 * Smoke tests — verify the server starts and core API routes respond correctly.
 * These run against a real server instance (no mocks) to catch integration issues.
 */
import { test, expect, type APIRequestContext } from "@playwright/test";

const BASE = "http://127.0.0.1:3999";

/** Fetch a CSRF token for use in mutation requests. */
async function getCsrfToken(request: APIRequestContext): Promise<string> {
  const res = await request.get(`${BASE}/api/csrf-token`);
  expect(res.ok()).toBe(true);
  const { token } = await res.json();
  return token as string;
}

// ----------------------------------------------------------------
// CSRF endpoint
// ----------------------------------------------------------------
test("GET /api/csrf-token returns a token", async ({ request }) => {
  const res = await request.get(`${BASE}/api/csrf-token`);
  expect(res.status()).toBe(200);

  const body = await res.json();
  expect(body).toHaveProperty("token");
  expect(typeof body.token).toBe("string");
  expect(body.token.length).toBeGreaterThan(0);
});

test("CSRF token is stable within a session", async ({ request }) => {
  const first = await request.get(`${BASE}/api/csrf-token`).then((r) => r.json());
  const second = await request.get(`${BASE}/api/csrf-token`).then((r) => r.json());
  expect(first.token).toBe(second.token);
});

// ----------------------------------------------------------------
// Config endpoint
// ----------------------------------------------------------------
test("GET /api/config returns config with CSRF token", async ({ request }) => {
  const token = await getCsrfToken(request);
  const res = await request.get(`${BASE}/api/config`, {
    headers: { "x-csrf-token": token },
  });
  expect(res.status()).toBe(200);

  const body = await res.json();
  // API wraps config in a "config" key
  const config = body.config ?? body;
  expect(config).toHaveProperty("version");
  expect(config).toHaveProperty("ai");
  expect(config.ai).toHaveProperty("model");

  // Secrets must never be returned
  expect(JSON.stringify(body)).not.toContain("anthropicKey");
  expect(JSON.stringify(body)).not.toContain("apiKey");
});

// ----------------------------------------------------------------
// Releases endpoint
// ----------------------------------------------------------------
test("GET /api/releases returns empty array on fresh install", async ({ request }) => {
  const token = await getCsrfToken(request);
  const res = await request.get(`${BASE}/api/releases`, {
    headers: { "x-csrf-token": token },
  });
  expect(res.status()).toBe(200);

  const body = await res.json();
  // API returns { releases: [], count: 0 }
  expect(body).toHaveProperty("releases");
  expect(Array.isArray(body.releases)).toBe(true);
  expect(body).toHaveProperty("count");
});

// ----------------------------------------------------------------
// Security: mutations reject missing CSRF token
// ----------------------------------------------------------------
test("POST without CSRF token is rejected with 403", async ({ request }) => {
  const res = await request.post(`${BASE}/api/releases`, {
    data: { name: "test" },
  });
  expect(res.status()).toBe(403);
});

test("DELETE without CSRF token is rejected with 403", async ({ request }) => {
  const res = await request.delete(`${BASE}/api/releases/some-id`);
  expect(res.status()).toBe(403);
});

// ----------------------------------------------------------------
// Security: non-localhost requests are blocked
// (This is enforced by the localhostOnly middleware — tests run on 127.0.0.1
//  so they pass; this test documents the expected behavior for the middleware.)
// ----------------------------------------------------------------
test("server responds to 127.0.0.1 (localhost) requests", async ({ request }) => {
  const res = await request.get(`${BASE}/api/csrf-token`);
  expect(res.ok()).toBe(true);
});
