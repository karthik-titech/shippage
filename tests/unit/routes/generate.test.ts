/**
 * Route-level tests for /api/generate
 * Covers validation, auth guards, and happy-path generation.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import express from "express";
import http from "http";

// ----------------------------------------------------------------
// Mocks
// ----------------------------------------------------------------
const fakeGeneratedContent = {
  headline: "Big Release",
  intro: "Lots of things changed.",
  sections: [{ title: "Features", items: [{ title: "Dark mode", description: "Finally.", ticketId: "", media: [] }] }],
  cta: { text: "Read more", url: "https://example.com" },
};

const fakeRelease = {
  id: "gen-release-uuid",
  projectName: "Acme",
  version: "v2.0",
  title: null,
  description: null,
  templateUsed: "minimal",
  sourceIntegration: "linear" as const,
  generatedContent: fakeGeneratedContent,
  generatedHtml: "<html>v2.0</html>",
  outputPath: null,
  status: "draft" as const,
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
};

vi.mock("../../../src/server/config/store.js", () => ({
  readConfig: vi.fn(() => ({
    integrations: {
      linear: {},
      github: { baseUrl: undefined, defaultOwner: undefined },
      jira: { baseUrl: "https://jira.example.com", email: "a@b.com", apiType: "cloud" },
      gitlab: { baseUrl: undefined },
      notion: {},
    },
    ai: { model: "claude-sonnet-4-6" },
    preferences: { companyName: "Acme", brandColor: "#2563EB", logoPath: null, pageFooter: null },
  })),
  getSecret: vi.fn(async (key: string) => {
    if (key === "anthropicKey") return "sk-test-key";
    return null;
  }),
  getPatForSource: vi.fn(async () => "fake-pat"),
  SHIPPAGE_DIR: "/tmp/.shippage-test",
  ensureShipPageDirs: vi.fn(),
}));

vi.mock("../../../src/server/services/linear.js", () => ({
  linearClient: {
    fetchCompletedTickets: vi.fn(async () => [
      {
        externalId: "LIN-1",
        source: "linear",
        title: "Add dark mode",
        description: "Users want dark mode",
        labels: ["feature"],
        assignee: null,
        status: "done",
        url: "https://linear.app/issue/LIN-1",
        completedAt: null,
        linkedPRs: [],
        linkedFigma: [],
        linkedLoom: [],
        rawData: {},
      },
    ]),
  },
}));

vi.mock("../../../src/server/services/github.js", () => ({
  githubClient: { fetchCompletedTickets: vi.fn(async () => []) },
}));

vi.mock("../../../src/server/services/jira.js", () => ({
  jiraClient: { fetchCompletedTickets: vi.fn(async () => []) },
}));

vi.mock("../../../src/server/services/gitlab.js", () => ({
  gitlabClient: { fetchCompletedTickets: vi.fn(async () => []) },
}));

vi.mock("../../../src/server/services/notion.js", () => ({
  notionClient: { fetchCompletedTickets: vi.fn(async () => []) },
}));

vi.mock("../../../src/server/services/ai-generator.js", () => ({
  generateReleasePage: vi.fn(async () => ({
    content: fakeGeneratedContent,
    metadata: {
      promptHash: "abc123",
      modelUsed: "claude-sonnet-4-6",
      tokensInput: 100,
      tokensOutput: 200,
      durationMs: 1500,
    },
  })),
  estimateInputTokens: vi.fn(() => 500),
}));

vi.mock("../../../src/server/services/template-engine.js", () => ({
  renderTemplate: vi.fn(() => "<html>rendered</html>"),
  listAvailableTemplates: vi.fn(() => []),
}));

vi.mock("../../../src/server/db/queries.js", () => ({
  createRelease: vi.fn(() => fakeRelease),
  snapshotTickets: vi.fn(),
  logGeneration: vi.fn(),
  updateRelease: vi.fn(() => ({ ...fakeRelease })),
  getRelease: vi.fn((id: string) => (id === "gen-release-uuid" ? fakeRelease : null)),
  getTicketsForRelease: vi.fn(() => [
    {
      externalId: "LIN-1",
      source: "linear",
      title: "Add dark mode",
      description: "Users want dark mode",
      labels: ["feature"],
      assignee: null,
      status: "done",
      url: "https://linear.app/issue/LIN-1",
      createdAt: "2024-01-01T00:00:00Z",
    },
  ]),
  getGenerationHistory: vi.fn(() => []),
  listReleases: vi.fn(() => []),
  deleteRelease: vi.fn(),
}));

// ----------------------------------------------------------------
// Test server setup
// ----------------------------------------------------------------
let server: http.Server;
let BASE: string;

beforeAll(async () => {
  const { generateRouter } = await import("../../../src/server/routes/generate.js");

  const app = express();
  app.use(express.json());
  app.use("/api/generate", generateRouter);

  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address() as { port: number };
  BASE = `http://127.0.0.1:${addr.port}/api/generate`;
});

afterAll(() => {
  server?.close();
});

// ----------------------------------------------------------------
// POST /api/generate — validation
// ----------------------------------------------------------------
describe("POST /api/generate — validation", () => {
  it("returns 400 when ticketIds is empty", async () => {
    const res = await fetch(`${BASE}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ticketIds: [],
        source: "linear",
        projectId: "team:abc",
        version: "v1.0",
        template: "minimal",
      }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid source", async () => {
    const res = await fetch(`${BASE}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ticketIds: ["LIN-1"],
        source: "unknown-source",
        projectId: "team:abc",
        version: "v1.0",
        template: "minimal",
      }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when version is missing", async () => {
    const res = await fetch(`${BASE}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ticketIds: ["LIN-1"],
        source: "linear",
        projectId: "team:abc",
        version: "",
        template: "minimal",
      }),
    });
    expect(res.status).toBe(400);
  });
});

// ----------------------------------------------------------------
// POST /api/generate — auth guards
// ----------------------------------------------------------------
describe("POST /api/generate — auth guards", () => {
  it("returns 400 when no Anthropic key configured", async () => {
    const { getSecret } = await import("../../../src/server/config/store.js");
    vi.mocked(getSecret).mockResolvedValueOnce(null);

    const res = await fetch(`${BASE}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ticketIds: ["LIN-1"],
        source: "linear",
        projectId: "team:abc",
        version: "v1.0",
        template: "minimal",
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("Anthropic");
  });

  it("returns 400 when no integration PAT configured", async () => {
    const { getPatForSource } = await import("../../../src/server/config/store.js");
    vi.mocked(getPatForSource).mockResolvedValueOnce(null);

    const res = await fetch(`${BASE}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ticketIds: ["LIN-1"],
        source: "linear",
        projectId: "team:abc",
        version: "v1.0",
        template: "minimal",
      }),
    });
    expect(res.status).toBe(400);
  });
});

// ----------------------------------------------------------------
// POST /api/generate — happy path
// ----------------------------------------------------------------
describe("POST /api/generate — happy path", () => {
  it("generates a release page and returns releaseId", async () => {
    const res = await fetch(`${BASE}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ticketIds: ["LIN-1"],
        source: "linear",
        projectId: "team:abc",
        version: "v1.0",
        template: "minimal",
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { releaseId: string; content: unknown; html: string };
    expect(body).toHaveProperty("releaseId");
    expect(body).toHaveProperty("content");
    expect(body).toHaveProperty("html");
  });
});

// ----------------------------------------------------------------
// POST /api/generate/:id/rerender
// ----------------------------------------------------------------
describe("POST /api/generate/:id/rerender", () => {
  it("returns 404 for unknown release", async () => {
    const res = await fetch(`${BASE}/unknown-id/rerender`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ template: "minimal" }),
    });
    expect(res.status).toBe(404);
  });

  it("rerenders with a new template for a valid release", async () => {
    const res = await fetch(`${BASE}/gen-release-uuid/rerender`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ template: "modern" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { html: string };
    expect(body).toHaveProperty("html");
  });
});

// ----------------------------------------------------------------
// POST /api/generate/:id/regenerate
// ----------------------------------------------------------------
describe("POST /api/generate/:id/regenerate", () => {
  it("returns 404 for unknown release", async () => {
    const res = await fetch(`${BASE}/unknown-id/regenerate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(404);
  });

  it("regenerates content for a valid release", async () => {
    const res = await fetch(`${BASE}/gen-release-uuid/regenerate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customInstructions: "Be concise." }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { content: unknown; html: string };
    expect(body).toHaveProperty("content");
    expect(body).toHaveProperty("html");
  });
});
