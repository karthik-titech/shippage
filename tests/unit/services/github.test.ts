import { describe, it, expect, vi, beforeEach } from "vitest";

// ----------------------------------------------------------------
// GitHub client tests — all HTTP calls are mocked via global.fetch
// ----------------------------------------------------------------

function mockResponse(opts: {
  ok: boolean;
  status?: number;
  json: unknown;
  linkHeader?: string;
}): Response {
  return {
    ok: opts.ok,
    status: opts.status ?? (opts.ok ? 200 : 400),
    statusText: opts.ok ? "OK" : "Error",
    headers: {
      get: (h: string) => {
        const name = h.toLowerCase();
        if (name === "link") return opts.linkHeader ?? null;
        if (name === "x-ratelimit-reset") return null;
        return null;
      },
    },
    json: async () => opts.json,
  } as unknown as Response;
}

/** Build a minimal GitHub issue object */
function makeIssue(overrides: Partial<{
  number: number;
  title: string;
  body: string | null;
  state: string;
  closed_at: string | null;
  pull_request: { url: string };
  labels: Array<{ name: string }>;
  assignee: { login: string } | null;
}> = {}) {
  return {
    number: 1,
    title: "Test issue",
    body: null,
    html_url: "https://github.com/owner/repo/issues/1",
    state: "closed",
    closed_at: new Date().toISOString(),
    labels: [],
    assignee: null,
    ...overrides,
  };
}

describe("githubClient.testConnection", () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it("returns ok:true when the API responds 200", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      mockResponse({ ok: true, json: { login: "testuser", id: 123 } })
    );

    const { githubClient } = await import("../../../src/server/services/github.js");
    const result = await githubClient.testConnection("fake-ghp_token");
    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("returns ok:false on 401 and does not echo the PAT", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      mockResponse({ ok: false, status: 401, json: { message: "Bad credentials" } })
    );

    const { githubClient } = await import("../../../src/server/services/github.js");
    const result = await githubClient.testConnection("ghp_supersecret_token_value");
    expect(result.ok).toBe(false);
    // SECURITY: the raw PAT must never appear in the error message
    expect(result.error).not.toContain("ghp_supersecret_token_value");
  });

  it("returns ok:false on 403", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      mockResponse({ ok: false, status: 403, json: { message: "Forbidden" } })
    );

    const { githubClient } = await import("../../../src/server/services/github.js");
    const result = await githubClient.testConnection("fake-pat");
    expect(result.ok).toBe(false);
  });
});

describe("githubClient.fetchCompletedTickets", () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it("returns closed issues as NormalizedTickets", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      mockResponse({ ok: true, json: [makeIssue({ number: 42, title: "Fix login bug" })] })
    );

    const { githubClient } = await import("../../../src/server/services/github.js");
    const tickets = await githubClient.fetchCompletedTickets("fake-pat", {
      projectId: "owner/repo",
      limit: 10,
    });

    expect(tickets).toHaveLength(1);
    expect(tickets[0]!.title).toBe("Fix login bug");
    expect(tickets[0]!.source).toBe("github");
    expect(tickets[0]!.status).toBe("closed");
    expect(tickets[0]!.externalId).toBe("repo#42");
  });

  it("filters out pull requests (issues with pull_request field)", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      mockResponse({
        ok: true,
        json: [
          makeIssue({ number: 1, title: "Real issue" }),
          makeIssue({
            number: 2,
            title: "A pull request",
            pull_request: { url: "https://api.github.com/repos/owner/repo/pulls/2" },
          }),
        ],
      })
    );

    const { githubClient } = await import("../../../src/server/services/github.js");
    const tickets = await githubClient.fetchCompletedTickets("fake-pat", {
      projectId: "owner/repo",
      limit: 10,
    });

    expect(tickets).toHaveLength(1);
    expect(tickets[0]!.title).toBe("Real issue");
  });

  it("extracts Figma and Loom URLs from issue body", async () => {
    const body = [
      "Design: https://www.figma.com/design/abc123/My-Design?node-id=0",
      "Demo: https://www.loom.com/share/xyz789abcdef",
    ].join("\n");

    global.fetch = vi.fn().mockResolvedValue(
      mockResponse({ ok: true, json: [makeIssue({ body })] })
    );

    const { githubClient } = await import("../../../src/server/services/github.js");
    const tickets = await githubClient.fetchCompletedTickets("fake-pat", {
      projectId: "owner/repo",
      limit: 10,
    });

    expect(tickets[0]!.linkedFigma).toHaveLength(1);
    expect(tickets[0]!.linkedFigma[0]).toContain("figma.com");
    expect(tickets[0]!.linkedLoom).toHaveLength(1);
    expect(tickets[0]!.linkedLoom[0]).toContain("loom.com");
  });

  it("extracts PR URLs from issue body into linkedPRs", async () => {
    const body = "Closes https://github.com/owner/repo/pull/99";

    global.fetch = vi.fn().mockResolvedValue(
      mockResponse({ ok: true, json: [makeIssue({ body })] })
    );

    const { githubClient } = await import("../../../src/server/services/github.js");
    const tickets = await githubClient.fetchCompletedTickets("fake-pat", {
      projectId: "owner/repo",
      limit: 10,
    });

    expect(tickets[0]!.linkedPRs).toHaveLength(1);
    expect(tickets[0]!.linkedPRs[0]).toContain("/pull/99");
  });

  it("respects the limit option", async () => {
    const manyIssues = Array.from({ length: 10 }, (_, i) =>
      makeIssue({ number: i + 1, title: `Issue ${i + 1}` })
    );

    global.fetch = vi.fn().mockResolvedValue(
      mockResponse({ ok: true, json: manyIssues })
    );

    const { githubClient } = await import("../../../src/server/services/github.js");
    const tickets = await githubClient.fetchCompletedTickets("fake-pat", {
      projectId: "owner/repo",
      limit: 3,
    });

    expect(tickets.length).toBeLessThanOrEqual(3);
  });

  it("throws on invalid projectId format", async () => {
    const { githubClient } = await import("../../../src/server/services/github.js");
    await expect(
      githubClient.fetchCompletedTickets("fake-pat", { projectId: "not-a-valid-id" })
    ).rejects.toThrow(/Invalid GitHub project ID/);
  });
});
