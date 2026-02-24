import { describe, it, expect, vi, beforeEach } from "vitest";
import type { JiraIntegrationConfig } from "../../../src/shared/types.js";

// ----------------------------------------------------------------
// Jira client tests — all HTTP calls are mocked via global.fetch
// ----------------------------------------------------------------

const CLOUD_CONFIG: JiraIntegrationConfig = {
  baseUrl: "https://example.atlassian.net",
  email: "user@test.com",
  apiType: "cloud",
};

const SERVER_CONFIG: JiraIntegrationConfig = {
  baseUrl: "https://jira.example.com",
  email: "user@test.com",
  apiType: "server",
};

function mockFetch(json: unknown, status = 200) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: async () => json,
  } as unknown as Response);
}

/** Minimal Jira issue in the shape returned by /search */
function makeJiraIssue(overrides: {
  key?: string;
  summary?: string;
  descriptionText?: string;
  statusName?: string;
} = {}) {
  return {
    id: "10001",
    key: overrides.key ?? "PROJ-1",
    self: "https://example.atlassian.net/rest/api/3/issue/10001",
    fields: {
      summary: overrides.summary ?? "Test ticket",
      description: overrides.descriptionText
        ? overrides.descriptionText  // plain string (Server v2 style)
        : null,
      status: {
        name: overrides.statusName ?? "Done",
        statusCategory: { name: "Done" },
      },
      labels: [],
      assignee: null,
      resolutiondate: null,
      updated: new Date().toISOString(),
    },
  };
}

describe("jiraClient.testConnection", () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it("returns ok:true for Cloud on 200 from /myself", async () => {
    mockFetch({ accountId: "abc123", displayName: "Test User" });

    const { jiraClient } = await import("../../../src/server/services/jira.js");
    const result = await jiraClient.testConnection(CLOUD_CONFIG, "fake-api-token");
    expect(result.ok).toBe(true);
  });

  it("returns ok:true for Server on 200 from /serverInfo", async () => {
    mockFetch({ version: "9.4.0", serverTitle: "Jira" });

    const { jiraClient } = await import("../../../src/server/services/jira.js");
    const result = await jiraClient.testConnection(SERVER_CONFIG, "fake-pat");
    expect(result.ok).toBe(true);
  });

  it("sends Basic auth (base64 email:token) for Cloud", async () => {
    mockFetch({ accountId: "abc" });

    const { jiraClient } = await import("../../../src/server/services/jira.js");
    await jiraClient.testConnection(CLOUD_CONFIG, "my-api-token");

    const callOptions = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
    const authHeader = (callOptions.headers as Record<string, string>)["Authorization"];

    expect(authHeader).toMatch(/^Basic /);
    // Verify it encodes email:token correctly
    const decoded = Buffer.from(authHeader.slice(6), "base64").toString("utf8");
    expect(decoded).toBe("user@test.com:my-api-token");
    // SECURITY: raw token must not appear in plain form
    expect(authHeader).not.toBe(`Basic my-api-token`);
  });

  it("sends Bearer auth for Server/DC", async () => {
    mockFetch({ version: "9.4.0" });

    const { jiraClient } = await import("../../../src/server/services/jira.js");
    await jiraClient.testConnection(SERVER_CONFIG, "my-server-pat");

    const callOptions = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
    const authHeader = (callOptions.headers as Record<string, string>)["Authorization"];

    expect(authHeader).toBe("Bearer my-server-pat");
  });

  it("uses /rest/api/3/ for Cloud and /rest/api/2/ for Server", async () => {
    mockFetch({ accountId: "abc" });
    const { jiraClient } = await import("../../../src/server/services/jira.js");

    await jiraClient.testConnection(CLOUD_CONFIG, "token");
    const cloudUrl = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(cloudUrl).toContain("/rest/api/3/");

    vi.resetAllMocks();
    mockFetch({ version: "9.4.0" });
    await jiraClient.testConnection(SERVER_CONFIG, "token");
    const serverUrl = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(serverUrl).toContain("/rest/api/2/");
  });

  it("returns ok:false on 401 for Cloud with a hint about API tokens", async () => {
    mockFetch({ errorMessages: ["Unauthorized"] }, 401);

    const { jiraClient } = await import("../../../src/server/services/jira.js");
    const result = await jiraClient.testConnection(CLOUD_CONFIG, "bad-token");

    expect(result.ok).toBe(false);
    expect(result.error?.toLowerCase()).toContain("cloud");
  });

  it("returns ok:false on 401 for Server with a hint about PATs", async () => {
    mockFetch({ errorMessages: ["Unauthorized"] }, 401);

    const { jiraClient } = await import("../../../src/server/services/jira.js");
    const result = await jiraClient.testConnection(SERVER_CONFIG, "bad-token");

    expect(result.ok).toBe(false);
    expect(result.error?.toLowerCase()).toContain("server");
  });

  it("returns ok:false on 403", async () => {
    mockFetch({ errorMessages: ["Forbidden"] }, 403);

    const { jiraClient } = await import("../../../src/server/services/jira.js");
    const result = await jiraClient.testConnection(CLOUD_CONFIG, "no-perms-token");

    expect(result.ok).toBe(false);
  });
});

describe("jiraClient.fetchCompletedTickets", () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it("returns tickets with statusCategory Done", async () => {
    mockFetch({
      issues: [makeJiraIssue({ key: "PROJ-1", summary: "Ship the thing" })],
      total: 1,
      startAt: 0,
      maxResults: 50,
    });

    const { jiraClient } = await import("../../../src/server/services/jira.js");
    const tickets = await jiraClient.fetchCompletedTickets(CLOUD_CONFIG, "token", {
      projectId: "PROJ",
      limit: 10,
    });

    expect(tickets).toHaveLength(1);
    expect(tickets[0]!.externalId).toBe("PROJ-1");
    expect(tickets[0]!.title).toBe("Ship the thing");
    expect(tickets[0]!.source).toBe("jira");
  });

  it("builds the issue URL from config.baseUrl", async () => {
    mockFetch({
      issues: [makeJiraIssue({ key: "ENG-42" })],
      total: 1, startAt: 0, maxResults: 50,
    });

    const { jiraClient } = await import("../../../src/server/services/jira.js");
    const tickets = await jiraClient.fetchCompletedTickets(CLOUD_CONFIG, "token", {});

    expect(tickets[0]!.url).toBe("https://example.atlassian.net/browse/ENG-42");
  });
});

describe("Jira ADF (Atlassian Document Format) description extraction", () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it("extracts plain text from ADF structure (Jira Cloud v3)", async () => {
    // ADF is a tree of nodes — Cloud uses it instead of plain Markdown
    const adfDescription = {
      type: "doc",
      version: 1,
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "This ticket covers the " },
            { type: "text", text: "authentication refactor" },
          ],
        },
      ],
    };

    mockFetch({
      issues: [{ ...makeJiraIssue(), fields: { ...makeJiraIssue().fields, description: adfDescription } }],
      total: 1, startAt: 0, maxResults: 50,
    });

    const { jiraClient } = await import("../../../src/server/services/jira.js");
    const tickets = await jiraClient.fetchCompletedTickets(CLOUD_CONFIG, "token", {});

    expect(tickets[0]!.description).toContain("authentication refactor");
  });

  it("handles plain string descriptions (Jira Server v2 style)", async () => {
    mockFetch({
      issues: [makeJiraIssue({ descriptionText: "Plain text description for server" })],
      total: 1, startAt: 0, maxResults: 50,
    });

    const { jiraClient } = await import("../../../src/server/services/jira.js");
    const tickets = await jiraClient.fetchCompletedTickets(SERVER_CONFIG, "token", {});

    expect(tickets[0]!.description).toBe("Plain text description for server");
  });

  it("extracts Figma URLs from ADF description", async () => {
    const adfWithFigma = {
      type: "doc",
      version: 1,
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Design: https://www.figma.com/design/abc123/My-Flow" },
          ],
        },
      ],
    };

    mockFetch({
      issues: [{ ...makeJiraIssue(), fields: { ...makeJiraIssue().fields, description: adfWithFigma } }],
      total: 1, startAt: 0, maxResults: 50,
    });

    const { jiraClient } = await import("../../../src/server/services/jira.js");
    const tickets = await jiraClient.fetchCompletedTickets(CLOUD_CONFIG, "token", {});

    expect(tickets[0]!.linkedFigma).toHaveLength(1);
    expect(tickets[0]!.linkedFigma[0]).toContain("figma.com");
  });

  it("returns null description when description is null", async () => {
    mockFetch({
      issues: [makeJiraIssue()], // description: null by default
      total: 1, startAt: 0, maxResults: 50,
    });

    const { jiraClient } = await import("../../../src/server/services/jira.js");
    const tickets = await jiraClient.fetchCompletedTickets(CLOUD_CONFIG, "token", {});

    expect(tickets[0]!.description).toBeNull();
  });
});
