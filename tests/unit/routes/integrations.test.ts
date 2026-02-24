/**
 * Route-level tests for /api/integrations
 * Uses a minimal Express app — no CSRF middleware, no localhost guard.
 * Service clients and config store are mocked.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import express from "express";
import http from "http";

// ----------------------------------------------------------------
// Mocks (must be defined before dynamic import of the router)
// ----------------------------------------------------------------
vi.mock("../../../src/server/config/store.js", () => ({
  readConfig: vi.fn(() => ({
    integrations: {
      linear: { defaultTeamId: "team-1" },
      github: { defaultOwner: "acme" },
      jira: { baseUrl: "https://jira.example.com", email: "a@b.com", apiType: "cloud" },
      gitlab: { baseUrl: "https://gitlab.com" },
      notion: { defaultDatabaseId: "db-1" },
    },
    ai: { model: "claude-sonnet-4-6", configured: false },
    preferences: { companyName: "Acme" },
  })),
  getPatForSource: vi.fn(async (source: string) => {
    // All sources configured by default in tests
    return `fake-pat-for-${source}`;
  }),
  getSecretStatus: vi.fn(async () => ({
    linear: true,
    github: true,
    jira: true,
    gitlab: true,
    notion: true,
    anthropic: true,
  })),
}));

vi.mock("../../../src/server/services/linear.js", () => ({
  linearClient: {
    testConnection: vi.fn(async () => ({ ok: true })),
    fetchProjects: vi.fn(async () => [{ id: "team:abc", name: "Team Alpha" }]),
    fetchCompletedTickets: vi.fn(async () => []),
  },
}));

vi.mock("../../../src/server/services/github.js", () => ({
  githubClient: {
    testConnection: vi.fn(async () => ({ ok: true })),
    fetchProjects: vi.fn(async () => [{ id: "acme/repo", name: "acme/repo" }]),
    fetchCompletedTickets: vi.fn(async () => []),
  },
}));

vi.mock("../../../src/server/services/jira.js", () => ({
  jiraClient: {
    testConnection: vi.fn(async () => ({ ok: true })),
    fetchProjects: vi.fn(async () => [{ id: "PROJ", name: "Project" }]),
    fetchCompletedTickets: vi.fn(async () => []),
  },
}));

vi.mock("../../../src/server/services/gitlab.js", () => ({
  gitlabClient: {
    testConnection: vi.fn(async () => ({ ok: true })),
    fetchProjects: vi.fn(async () => [{ id: "123", name: "My Repo" }]),
    fetchCompletedTickets: vi.fn(async () => []),
  },
}));

vi.mock("../../../src/server/services/notion.js", () => ({
  notionClient: {
    testConnection: vi.fn(async () => ({ ok: true })),
    fetchProjects: vi.fn(async () => [{ id: "db-uuid", name: "Tasks DB" }]),
    fetchCompletedTickets: vi.fn(async () => []),
    fetchParentPages: vi.fn(async () => []),
    publishReleasePage: vi.fn(async () => ({ url: "https://notion.so/page" })),
  },
}));

// ----------------------------------------------------------------
// Test server setup
// ----------------------------------------------------------------
let server: http.Server;
let BASE: string;

beforeAll(async () => {
  const { integrationsRouter } = await import(
    "../../../src/server/routes/integrations.js"
  );

  const app = express();
  app.use(express.json());
  app.use("/api/integrations", integrationsRouter);

  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address() as { port: number };
  BASE = `http://127.0.0.1:${addr.port}/api/integrations`;
});

afterAll(() => {
  server?.close();
});

// ----------------------------------------------------------------
// GET /api/integrations/status
// ----------------------------------------------------------------
describe("GET /api/integrations/status", () => {
  it("returns all 5 integration statuses", async () => {
    const res = await fetch(`${BASE}/status`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      integrations: Record<string, { configured: boolean }>;
    };
    for (const key of ["linear", "github", "jira", "gitlab", "notion"]) {
      expect(body.integrations).toHaveProperty(key);
      expect(typeof body.integrations[key].configured).toBe("boolean");
    }
  });

  it("includes ai and preferences sections", async () => {
    const res = await fetch(`${BASE}/status`);
    const body = (await res.json()) as { ai: unknown; preferences: unknown };
    expect(body).toHaveProperty("ai");
    expect(body).toHaveProperty("preferences");
  });
});

// ----------------------------------------------------------------
// POST /api/integrations/test
// ----------------------------------------------------------------
describe("POST /api/integrations/test", () => {
  it("returns 400 for unknown source", async () => {
    const res = await fetch(`${BASE}/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: "unknown-source" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when no PAT is configured", async () => {
    const { getPatForSource } = await import("../../../src/server/config/store.js");
    vi.mocked(getPatForSource).mockResolvedValueOnce(null);

    const res = await fetch(`${BASE}/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: "linear" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(false);
  });

  it("calls the linear client and returns ok:true", async () => {
    const res = await fetch(`${BASE}/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: "linear" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("tests all 5 sources without errors", async () => {
    for (const source of ["linear", "github", "jira", "gitlab", "notion"]) {
      const res = await fetch(`${BASE}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source }),
      });
      expect(res.status).toBe(200);
    }
  });
});

// ----------------------------------------------------------------
// GET /api/integrations/projects
// ----------------------------------------------------------------
describe("GET /api/integrations/projects", () => {
  it("returns 400 when source param is missing", async () => {
    const res = await fetch(`${BASE}/projects`);
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid source", async () => {
    const res = await fetch(`${BASE}/projects?source=evil`);
    expect(res.status).toBe(400);
  });

  it("returns 400 when no PAT configured", async () => {
    const { getPatForSource } = await import("../../../src/server/config/store.js");
    vi.mocked(getPatForSource).mockResolvedValueOnce(null);

    const res = await fetch(`${BASE}/projects?source=github`);
    expect(res.status).toBe(400);
  });

  it("returns projects array for valid source", async () => {
    const res = await fetch(`${BASE}/projects?source=linear`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { projects: unknown[] };
    expect(Array.isArray(body.projects)).toBe(true);
  });
});

// ----------------------------------------------------------------
// GET /api/integrations/tickets
// ----------------------------------------------------------------
describe("GET /api/integrations/tickets", () => {
  it("returns 400 when source param is missing", async () => {
    const res = await fetch(`${BASE}/tickets`);
    expect(res.status).toBe(400);
  });

  it("returns 400 when no PAT configured", async () => {
    const { getPatForSource } = await import("../../../src/server/config/store.js");
    vi.mocked(getPatForSource).mockResolvedValueOnce(null);

    const res = await fetch(`${BASE}/tickets?source=linear`);
    expect(res.status).toBe(400);
  });

  it("returns 400 when GitHub source has no projectId", async () => {
    const res = await fetch(`${BASE}/tickets?source=github`);
    expect(res.status).toBe(400);
  });

  it("returns 400 when GitLab source has no projectId", async () => {
    const res = await fetch(`${BASE}/tickets?source=gitlab`);
    expect(res.status).toBe(400);
  });

  it("returns 400 when Notion source has no projectId", async () => {
    const res = await fetch(`${BASE}/tickets?source=notion`);
    expect(res.status).toBe(400);
  });

  it("returns tickets array for linear (no projectId required)", async () => {
    const res = await fetch(`${BASE}/tickets?source=linear`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tickets: unknown[]; count: number };
    expect(Array.isArray(body.tickets)).toBe(true);
    expect(typeof body.count).toBe("number");
  });
});
