import { describe, it, expect, vi, beforeEach } from "vitest";

// ----------------------------------------------------------------
// Linear client tests — all HTTP calls are mocked
// ----------------------------------------------------------------

describe("linearClient.testConnection", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns ok:true on successful authentication", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ data: { viewer: { id: "user-1", name: "Test User" } } }),
    } as unknown as Response);

    const { linearClient } = await import("../../../src/server/services/linear.js");
    const result = await linearClient.testConnection("fake-pat");
    expect(result.ok).toBe(true);
  });

  it("returns ok:false without exposing PAT on 401", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 401,
      headers: { get: () => null },
      json: async () => ({ errors: [{ message: "Unauthorized: invalid token fake-pat" }] }),
    } as unknown as Response);

    const { linearClient } = await import("../../../src/server/services/linear.js");
    const result = await linearClient.testConnection("fake-pat");

    expect(result.ok).toBe(false);
    // SECURITY: error message must NOT contain the PAT
    expect(result.error).not.toContain("fake-pat");
  });
});

describe("URL extraction", () => {
  it("extracts Figma URLs from ticket descriptions", async () => {
    // Test the extraction logic indirectly through normalizeIssue
    // by checking that a ticket with a Figma URL has it in linkedFigma
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({
        data: {
          team: {
            issues: {
              nodes: [
                {
                  id: "issue-1",
                  identifier: "ENG-1",
                  title: "Fix the thing",
                  description:
                    "Design: https://www.figma.com/design/abc123/My-Design\nLoom: https://www.loom.com/share/xyz789",
                  url: "https://linear.app/team/issue/ENG-1",
                  state: { name: "Done", type: "completed" },
                  completedAt: new Date().toISOString(),
                  labels: { nodes: [] },
                  assignee: null,
                  attachments: { nodes: [] },
                },
              ],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        },
      }),
    } as unknown as Response);

    const { linearClient } = await import("../../../src/server/services/linear.js");
    const tickets = await linearClient.fetchCompletedTickets("fake-pat", {
      projectId: "team-id",
      limit: 10,
    });

    expect(tickets).toHaveLength(1);
    expect(tickets[0]!.linkedFigma).toHaveLength(1);
    expect(tickets[0]!.linkedFigma[0]).toContain("figma.com");
    expect(tickets[0]!.linkedLoom).toHaveLength(1);
    expect(tickets[0]!.linkedLoom[0]).toContain("loom.com");
  });
});
