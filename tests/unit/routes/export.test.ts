/**
 * Route-level tests for /api/export
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import express from "express";
import http from "http";

// ----------------------------------------------------------------
// Mocks
// ----------------------------------------------------------------
const fakeRelease = {
  id: "11111111-1111-1111-1111-111111111111",
  projectName: "Acme",
  version: "v1.0",
  title: null,
  description: null,
  templateUsed: "minimal",
  sourceIntegration: "linear" as const,
  generatedContent: {
    headline: "Hello World",
    intro: "Intro text",
    sections: [],
    cta: { text: "Learn more", url: "https://example.com" },
  },
  generatedHtml: "<html><body>Hello</body></html>",
  outputPath: null,
  status: "draft" as const,
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
};

vi.mock("../../../src/server/db/queries.js", () => ({
  getRelease: vi.fn((id: string) => (id === "11111111-1111-1111-1111-111111111111" ? fakeRelease : null)),
  createRelease: vi.fn(),
  updateRelease: vi.fn((id: string) => ({ ...fakeRelease, id })),
  snapshotTickets: vi.fn(),
  listReleases: vi.fn(() => []),
  deleteRelease: vi.fn(),
  getTicketsForRelease: vi.fn(() => []),
  getGenerationHistory: vi.fn(() => []),
  logGeneration: vi.fn(),
}));

vi.mock("../../../src/server/services/html-exporter.js", () => ({
  exportRelease: vi.fn(async () => ({
    path: "/tmp/test-export.html",
    filename: "test-export.html",
    sizeBytes: 1024,
  })),
}));

vi.mock("../../../src/server/services/template-engine.js", () => ({
  listAvailableTemplates: vi.fn(() => [
    { name: "minimal", source: "/* css */" },
    { name: "modern", source: "/* css */" },
  ]),
  renderTemplate: vi.fn(() => "<html>rendered</html>"),
}));

vi.mock("../../../src/server/services/notion.js", () => ({
  notionClient: {
    publishReleasePage: vi.fn(async () => ({ url: "https://notion.so/page-123" })),
    fetchParentPages: vi.fn(async () => [{ id: "page-1", name: "Release Notes" }]),
  },
}));

vi.mock("../../../src/server/config/store.js", () => ({
  getSecret: vi.fn(async (key: string) => {
    if (key === "notionToken") return "test-notion-token";
    return null;
  }),
  SHIPPAGE_DIR: "/tmp/.shippage-test",
  ensureShipPageDirs: vi.fn(),
}));

// ----------------------------------------------------------------
// Test server setup
// ----------------------------------------------------------------
let server: http.Server;
let BASE: string;

beforeAll(async () => {
  const { exportRouter } = await import("../../../src/server/routes/export.js");

  const app = express();
  app.use(express.json());
  app.use("/api/export", exportRouter);

  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address() as { port: number };
  BASE = `http://127.0.0.1:${addr.port}/api/export`;
});

afterAll(() => {
  server?.close();
});

// ----------------------------------------------------------------
// GET /api/export/templates
// ----------------------------------------------------------------
describe("GET /api/export/templates", () => {
  it("returns available templates", async () => {
    const res = await fetch(`${BASE}/templates`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { templates: Array<{ name: string }> };
    expect(Array.isArray(body.templates)).toBe(true);
    expect(body.templates.length).toBeGreaterThan(0);
    expect(body.templates[0]).toHaveProperty("name");
  });
});

// ----------------------------------------------------------------
// GET /api/export/:releaseId/html
// ----------------------------------------------------------------
describe("GET /api/export/:releaseId/html", () => {
  it("returns HTML for a valid release", async () => {
    const res = await fetch(`${BASE}/11111111-1111-1111-1111-111111111111/html`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  it("returns 404 for an unknown release", async () => {
    const res = await fetch(`${BASE}/unknown-id-9999/html`);
    expect(res.status).toBe(404);
  });
});

// ----------------------------------------------------------------
// POST /api/export
// ----------------------------------------------------------------
describe("POST /api/export", () => {
  it("returns 400 when releaseId is not a UUID", async () => {
    const res = await fetch(`${BASE}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ releaseId: "not-a-uuid", mode: "single-file" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 404 for an unknown release UUID", async () => {
    const res = await fetch(`${BASE}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ releaseId: "00000000-0000-0000-0000-000000000000", mode: "single-file" }),
    });
    expect(res.status).toBe(404);
  });

  it("exports a valid release successfully", async () => {
    const res = await fetch(`${BASE}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ releaseId: "11111111-1111-1111-1111-111111111111", mode: "single-file" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { path: string; sizeBytes: number };
    expect(body).toHaveProperty("path");
    expect(body).toHaveProperty("sizeBytes");
  });
});

// ----------------------------------------------------------------
// GET /api/export/notion/pages
// ----------------------------------------------------------------
describe("GET /api/export/notion/pages", () => {
  it("returns notion pages when configured", async () => {
    const res = await fetch(`${BASE}/notion/pages`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { pages: Array<{ id: string; name: string }> };
    expect(Array.isArray(body.pages)).toBe(true);
  });

  it("returns 400 when notion not configured", async () => {
    const { getSecret } = await import("../../../src/server/config/store.js");
    vi.mocked(getSecret).mockResolvedValueOnce(null);

    const res = await fetch(`${BASE}/notion/pages`);
    expect(res.status).toBe(400);
  });
});

// ----------------------------------------------------------------
// POST /api/export/notion
// ----------------------------------------------------------------
describe("POST /api/export/notion", () => {
  it("returns 400 when releaseId is not a UUID", async () => {
    const res = await fetch(`${BASE}/notion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ releaseId: "bad-id", parentPageId: "page-1" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when parentPageId is empty", async () => {
    const res = await fetch(`${BASE}/notion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ releaseId: "11111111-1111-1111-1111-111111111111", parentPageId: "" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 404 for an unknown release UUID", async () => {
    const res = await fetch(`${BASE}/notion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        releaseId: "00000000-0000-0000-0000-000000000000",
        parentPageId: "page-1",
      }),
    });
    expect(res.status).toBe(404);
  });

  it("publishes to Notion and returns a URL", async () => {
    const res = await fetch(`${BASE}/notion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ releaseId: "11111111-1111-1111-1111-111111111111", parentPageId: "page-1" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string };
    expect(body.url).toContain("notion.so");
  });

  it("returns 400 when Notion not configured", async () => {
    const { getSecret } = await import("../../../src/server/config/store.js");
    vi.mocked(getSecret).mockResolvedValueOnce(null);

    const res = await fetch(`${BASE}/notion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ releaseId: "11111111-1111-1111-1111-111111111111", parentPageId: "page-1" }),
    });
    expect(res.status).toBe(400);
  });
});
