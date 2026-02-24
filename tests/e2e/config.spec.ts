/**
 * Config route tests — covers GET /api/config, POST /api/config/secrets,
 * and PATCH /api/config against a real running server.
 */
import { test, expect, type APIRequestContext } from "@playwright/test";

const BASE = "http://127.0.0.1:3999";

async function getCsrfToken(request: APIRequestContext): Promise<string> {
  const res = await request.get(`${BASE}/api/csrf-token`);
  const { token } = await res.json();
  return token as string;
}

// ----------------------------------------------------------------
// GET /api/config
// ----------------------------------------------------------------
test("GET /api/config returns all five integration slots", async ({ request }) => {
  const res = await request.get(`${BASE}/api/config`);
  expect(res.status()).toBe(200);

  const { config } = await res.json();
  expect(config.integrations).toHaveProperty("linear");
  expect(config.integrations).toHaveProperty("github");
  expect(config.integrations).toHaveProperty("jira");
  expect(config.integrations).toHaveProperty("gitlab");
  expect(config.integrations).toHaveProperty("notion");
});

test("GET /api/config each integration has a configured boolean", async ({ request }) => {
  const res = await request.get(`${BASE}/api/config`);
  const { config } = await res.json();

  for (const key of ["linear", "github", "jira", "gitlab", "notion"]) {
    expect(typeof config.integrations[key].configured).toBe("boolean");
  }
});

test("GET /api/config never exposes secret values", async ({ request }) => {
  const res = await request.get(`${BASE}/api/config`);
  const body = JSON.stringify(await res.json());

  // These field names should never appear in the response
  for (const forbidden of ["pat", "token", "apiKey", "password", "secret"]) {
    expect(body.toLowerCase()).not.toContain(`"${forbidden}"`);
  }
});

test("GET /api/config returns ai and preferences sections", async ({ request }) => {
  const res = await request.get(`${BASE}/api/config`);
  const { config } = await res.json();

  expect(config).toHaveProperty("ai");
  expect(config.ai).toHaveProperty("model");
  expect(config.ai).toHaveProperty("configured");
  expect(config).toHaveProperty("preferences");
  expect(config.preferences).toHaveProperty("defaultTemplate");
});

// ----------------------------------------------------------------
// POST /api/config/secrets
// ----------------------------------------------------------------
test("POST /api/config/secrets without CSRF is rejected with 403", async ({ request }) => {
  const res = await request.post(`${BASE}/api/config/secrets`, {
    data: { key: "linearPat", value: "some-value" },
  });
  expect(res.status()).toBe(403);
});

test("POST /api/config/secrets with invalid key returns 400", async ({ request }) => {
  const token = await getCsrfToken(request);
  const res = await request.post(`${BASE}/api/config/secrets`, {
    headers: { "x-csrf-token": token },
    data: { key: "unknownKey", value: "some-value" },
  });
  expect(res.status()).toBe(400);
});

test("POST /api/config/secrets with empty value returns 400", async ({ request }) => {
  const token = await getCsrfToken(request);
  const res = await request.post(`${BASE}/api/config/secrets`, {
    headers: { "x-csrf-token": token },
    data: { key: "linearPat", value: "" },
  });
  expect(res.status()).toBe(400);
});

test("POST /api/config/secrets accepts all valid keys", async ({ request }) => {
  const token = await getCsrfToken(request);

  for (const key of ["linearPat", "githubPat", "jiraPat", "gitlabPat", "notionToken", "anthropicKey"]) {
    const res = await request.post(`${BASE}/api/config/secrets`, {
      headers: { "x-csrf-token": token },
      data: { key, value: "test-value-do-not-use" },
    });
    // Should succeed (200) — actual keychain write may or may not work in CI but shouldn't 400
    expect(res.status()).not.toBe(400);
    // Response must never echo the secret value back
    const body = JSON.stringify(await res.json());
    expect(body).not.toContain("test-value-do-not-use");
  }
});

// ----------------------------------------------------------------
// PATCH /api/config
// ----------------------------------------------------------------
test("PATCH /api/config without CSRF is rejected with 403", async ({ request }) => {
  const res = await request.patch(`${BASE}/api/config`, {
    data: { preferences: { companyName: "Evil Corp" } },
  });
  expect(res.status()).toBe(403);
});

test("PATCH /api/config with invalid brandColor returns 400", async ({ request }) => {
  const token = await getCsrfToken(request);
  const res = await request.patch(`${BASE}/api/config`, {
    headers: { "x-csrf-token": token },
    data: { preferences: { brandColor: "not-a-hex-color" } },
  });
  expect(res.status()).toBe(400);
});

test("PATCH /api/config updates preferences successfully", async ({ request }) => {
  const token = await getCsrfToken(request);
  const res = await request.patch(`${BASE}/api/config`, {
    headers: { "x-csrf-token": token },
    data: { preferences: { companyName: "Test Corp", brandColor: "#FF5733" } },
  });
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.ok).toBe(true);

  // Verify the change is reflected in GET
  const getRes = await request.get(`${BASE}/api/config`);
  const { config } = await getRes.json();
  expect(config.preferences.companyName).toBe("Test Corp");
  expect(config.preferences.brandColor).toBe("#FF5733");
});

test("PATCH /api/config accepts gitlab and notion integration config", async ({ request }) => {
  const token = await getCsrfToken(request);
  const res = await request.patch(`${BASE}/api/config`, {
    headers: { "x-csrf-token": token },
    data: {
      integrations: {
        gitlab: { baseUrl: "https://gitlab.example.com" },
        notion: {},
      },
    },
  });
  expect(res.status()).toBe(200);
});

test("PATCH /api/config rejects invalid gitlab baseUrl", async ({ request }) => {
  const token = await getCsrfToken(request);
  const res = await request.patch(`${BASE}/api/config`, {
    headers: { "x-csrf-token": token },
    data: { integrations: { gitlab: { baseUrl: "not-a-url" } } },
  });
  expect(res.status()).toBe(400);
});
