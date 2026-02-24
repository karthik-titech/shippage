import { describe, it, expect, vi, beforeEach } from "vitest";

// ----------------------------------------------------------------
// GitLab client tests — all HTTP calls are mocked
// ----------------------------------------------------------------

function mockResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (key: string) => headers[key] ?? null },
    json: async () => body,
  } as unknown as Response;
}

describe("gitlabClient.testConnection", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns ok:true on successful authentication", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(
      mockResponse({ id: 1, username: "testuser" })
    );

    const { gitlabClient } = await import("../../../src/server/services/gitlab.js");
    const result = await gitlabClient.testConnection("fake-pat");
    expect(result.ok).toBe(true);
  });

  it("returns ok:false without exposing PAT on 401", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(mockResponse({ message: "401 Unauthorized" }, 401));

    const { gitlabClient } = await import("../../../src/server/services/gitlab.js");
    const result = await gitlabClient.testConnection("fake-pat");

    expect(result.ok).toBe(false);
    // SECURITY: error message must NOT contain the PAT
    expect(result.error).not.toContain("fake-pat");
  });

  it("returns ok:false on network error", async () => {
    global.fetch = vi.fn().mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const { gitlabClient } = await import("../../../src/server/services/gitlab.js");
    const result = await gitlabClient.testConnection("fake-pat", "https://gitlab.example.com");

    expect(result.ok).toBe(false);
  });
});

describe("gitlabClient.fetchProjects", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns projects mapped from GitLab API", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(
      mockResponse([
        { id: 42, name: "my-app", path_with_namespace: "acme/my-app" },
        { id: 43, name: "backend", path_with_namespace: "acme/backend" },
      ])
    );

    const { gitlabClient } = await import("../../../src/server/services/gitlab.js");
    const projects = await gitlabClient.fetchProjects("fake-pat");

    expect(projects).toHaveLength(2);
    expect(projects[0]).toEqual({ id: "42", name: "acme/my-app" });
    expect(projects[1]).toEqual({ id: "43", name: "acme/backend" });
  });

  it("follows Link header pagination", async () => {
    const page1Headers = { Link: `<https://gitlab.com/api/v4/projects?page=2>; rel="next"` };
    const page2Headers = {};

    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({ ...mockResponse([{ id: 1, name: "p1", path_with_namespace: "org/p1" }]), headers: { get: (k: string) => page1Headers[k as keyof typeof page1Headers] ?? null } })
      .mockResolvedValueOnce({ ...mockResponse([{ id: 2, name: "p2", path_with_namespace: "org/p2" }]), headers: { get: (k: string) => page2Headers[k as keyof typeof page2Headers] ?? null } });

    const { gitlabClient } = await import("../../../src/server/services/gitlab.js");
    const projects = await gitlabClient.fetchProjects("fake-pat");
    expect(projects).toHaveLength(2);
  });
});

describe("gitlabClient.fetchCompletedTickets", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("maps GitLab issues to NormalizedTicket shape", async () => {
    const issuesList = [
      {
        iid: 7,
        title: "Fix the login bug",
        description: "Something is broken",
        web_url: "https://gitlab.com/acme/my-app/-/issues/7",
        state: "closed",
        closed_at: "2024-12-01T10:00:00Z",
        labels: ["bug", "backend"],
        assignee: { name: "Alice" },
        project_id: 42,
      },
    ];

    // First call: issues list (pagination); second call: project details
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(mockResponse(issuesList))
      .mockResolvedValueOnce(mockResponse({ id: 42, path_with_namespace: "acme/my-app" }));

    const { gitlabClient } = await import("../../../src/server/services/gitlab.js");
    const tickets = await gitlabClient.fetchCompletedTickets("fake-pat", { projectId: "42" });

    expect(tickets).toHaveLength(1);
    const t = tickets[0]!;
    expect(t.source).toBe("gitlab");
    expect(t.externalId).toBe("acme/my-app#7");
    expect(t.title).toBe("Fix the login bug");
    expect(t.labels).toEqual(["bug", "backend"]);
    expect(t.assignee).toBe("Alice");
    expect(t.status).toBe("closed");
    expect(t.completedAt).toBe("2024-12-01T10:00:00Z");
    expect(t.linkedPRs).toEqual([]);
  });

  it("extracts Figma and Loom URLs from issue description", async () => {
    const issuesList = [
      {
        iid: 3,
        title: "Redesign dashboard",
        description:
          "Design: https://www.figma.com/design/abc123/Dashboard\nDemo: https://www.loom.com/share/xyz789",
        web_url: "https://gitlab.com/acme/my-app/-/issues/3",
        state: "closed",
        closed_at: "2024-12-01T10:00:00Z",
        labels: [],
        assignee: null,
        project_id: 42,
      },
    ];

    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(mockResponse(issuesList))
      .mockResolvedValueOnce(mockResponse({ id: 42, path_with_namespace: "acme/my-app" }));

    const { gitlabClient } = await import("../../../src/server/services/gitlab.js");
    const tickets = await gitlabClient.fetchCompletedTickets("fake-pat", { projectId: "42" });

    expect(tickets[0]!.linkedFigma).toHaveLength(1);
    expect(tickets[0]!.linkedFigma[0]).toContain("figma.com");
    expect(tickets[0]!.linkedLoom).toHaveLength(1);
    expect(tickets[0]!.linkedLoom[0]).toContain("loom.com");
  });

  it("respects the limit option", async () => {
    const issues = Array.from({ length: 5 }, (_, i) => ({
      iid: i + 1,
      title: `Issue ${i + 1}`,
      description: null,
      web_url: `https://gitlab.com/acme/app/-/issues/${i + 1}`,
      state: "closed",
      closed_at: "2024-12-01T10:00:00Z",
      labels: [],
      assignee: null,
      project_id: 42,
    }));

    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(mockResponse(issues))
      .mockResolvedValueOnce(mockResponse({ id: 42, path_with_namespace: "acme/app" }));

    const { gitlabClient } = await import("../../../src/server/services/gitlab.js");
    const tickets = await gitlabClient.fetchCompletedTickets("fake-pat", {
      projectId: "42",
      limit: 3,
    });

    expect(tickets).toHaveLength(3);
  });
});
