import { describe, it, expect, vi, beforeEach } from "vitest";

// ----------------------------------------------------------------
// Notion client tests — all HTTP calls are mocked
// ----------------------------------------------------------------

function mockResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response;
}

describe("notionClient.testConnection", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns ok:true on successful authentication", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(
      mockResponse({ object: "user", id: "user-1", name: "Test Bot" })
    );

    const { notionClient } = await import("../../../src/server/services/notion.js");
    const result = await notionClient.testConnection("fake-token");
    expect(result.ok).toBe(true);
  });

  it("returns ok:false without exposing token on 401", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(
      mockResponse({ message: "API token is invalid." }, 401)
    );

    const { notionClient } = await import("../../../src/server/services/notion.js");
    const result = await notionClient.testConnection("fake-token");

    expect(result.ok).toBe(false);
    // SECURITY: error message must NOT contain the token
    expect(result.error).not.toContain("fake-token");
  });
});

describe("notionClient.fetchProjects", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns databases as projects", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(
      mockResponse({
        results: [
          { id: "db-1", title: [{ plain_text: "Release Tracker" }] },
          { id: "db-2", title: [{ plain_text: "Bug Board" }] },
        ],
        has_more: false,
        next_cursor: null,
      })
    );

    const { notionClient } = await import("../../../src/server/services/notion.js");
    const projects = await notionClient.fetchProjects("fake-token");

    expect(projects).toHaveLength(2);
    expect(projects[0]).toEqual({ id: "db-1", name: "Release Tracker" });
    expect(projects[1]).toEqual({ id: "db-2", name: "Bug Board" });
  });

  it("uses '(Untitled database)' for empty title", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(
      mockResponse({
        results: [{ id: "db-3", title: [] }],
        has_more: false,
        next_cursor: null,
      })
    );

    const { notionClient } = await import("../../../src/server/services/notion.js");
    const projects = await notionClient.fetchProjects("fake-token");

    expect(projects[0]!.name).toBe("(Untitled database)");
  });
});

describe("notionClient.fetchCompletedTickets", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  function makeDbSchema(statusPropName = "Status") {
    return {
      properties: {
        Name: { type: "title", name: "Name" },
        [statusPropName]: { type: "status", name: statusPropName },
        Tags: { type: "multi_select", name: "Tags" },
        Assignee: { type: "people", name: "Assignee" },
      },
    };
  }

  function makePage(title: string, statusName: string, extra: Record<string, unknown> = {}) {
    return {
      id: `page-${title}`,
      url: `https://notion.so/page-${title}`,
      created_time: "2024-12-01T10:00:00Z",
      last_edited_time: "2024-12-01T10:00:00Z",
      properties: {
        Name: { type: "title", title: [{ plain_text: title }] },
        Status: { type: "status", status: { name: statusName } },
        Tags: { type: "multi_select", multi_select: [{ name: "feature" }] },
        Assignee: { type: "people", people: [{ name: "Bob" }] },
        ...extra,
      },
    };
  }

  it("returns only done-status pages", async () => {
    const schema = makeDbSchema();
    const pages = [
      makePage("Shipped Feature", "Done"),
      makePage("In Progress Task", "In Progress"),
      makePage("Completed Fix", "Complete"),
    ];

    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(mockResponse(schema)) // DB schema
      .mockResolvedValueOnce(
        mockResponse({ results: pages, has_more: false, next_cursor: null })
      ); // query

    const { notionClient } = await import("../../../src/server/services/notion.js");
    const tickets = await notionClient.fetchCompletedTickets("fake-token", {
      projectId: "db-1",
    });

    // "In Progress" is skipped; "Done" and "Complete" pass the filter
    expect(tickets).toHaveLength(2);
    expect(tickets.map((t) => t.title)).toContain("Shipped Feature");
    expect(tickets.map((t) => t.title)).toContain("Completed Fix");
    expect(tickets.map((t) => t.title)).not.toContain("In Progress Task");
  });

  it("maps page properties to NormalizedTicket correctly", async () => {
    const schema = makeDbSchema();
    const page = makePage("Build the thing", "Done");

    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(mockResponse(schema))
      .mockResolvedValueOnce(
        mockResponse({ results: [page], has_more: false, next_cursor: null })
      );

    const { notionClient } = await import("../../../src/server/services/notion.js");
    const tickets = await notionClient.fetchCompletedTickets("fake-token", { projectId: "db-1" });

    expect(tickets).toHaveLength(1);
    const t = tickets[0]!;
    expect(t.source).toBe("notion");
    expect(t.title).toBe("Build the thing");
    expect(t.labels).toEqual(["feature"]);
    expect(t.assignee).toBe("Bob");
    expect(t.status).toBe("Done");
  });

  it("extracts Figma and Loom URLs from rich text description", async () => {
    const schema = {
      properties: {
        Name: { type: "title", name: "Name" },
        Notes: { type: "rich_text", name: "Notes" },
      },
    };
    const page = {
      id: "page-design",
      url: "https://notion.so/page-design",
      created_time: "2024-12-01T10:00:00Z",
      last_edited_time: "2024-12-01T10:00:00Z",
      properties: {
        Name: { type: "title", title: [{ plain_text: "Design page" }] },
        Notes: {
          type: "rich_text",
          rich_text: [
            {
              plain_text:
                "Design: https://www.figma.com/design/abc123/My-Design Demo: https://www.loom.com/share/xyz789",
            },
          ],
        },
      },
    };

    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(mockResponse(schema))
      .mockResolvedValueOnce(
        mockResponse({ results: [page], has_more: false, next_cursor: null })
      );

    const { notionClient } = await import("../../../src/server/services/notion.js");
    const tickets = await notionClient.fetchCompletedTickets("fake-token", { projectId: "db-1" });

    // No status property → all items returned
    expect(tickets).toHaveLength(1);
    expect(tickets[0]!.linkedFigma).toHaveLength(1);
    expect(tickets[0]!.linkedFigma[0]).toContain("figma.com");
    expect(tickets[0]!.linkedLoom).toHaveLength(1);
    expect(tickets[0]!.linkedLoom[0]).toContain("loom.com");
  });
});
