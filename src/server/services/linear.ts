import type { NormalizedTicket } from "../../shared/types.js";

// ----------------------------------------------------------------
// Linear API client
// Uses GraphQL API: https://api.linear.app/graphql
// Auth: Authorization: Bearer ${pat}
// ----------------------------------------------------------------

const LINEAR_API_URL = "https://api.linear.app/graphql";
const REQUEST_TIMEOUT_MS = 30_000;

// Regex patterns for extracting media links from descriptions
const FIGMA_URL_REGEX = /https:\/\/(?:www\.)?figma\.com\/(?:file|design|proto)\/[^\s"')>]+/g;
const LOOM_URL_REGEX = /https:\/\/(?:www\.)?loom\.com\/(?:share|embed)\/[^\s"')>]+/g;

function extractUrls(text: string, regex: RegExp): string[] {
  const matches = text.matchAll(regex);
  return [...new Set([...matches].map((m) => m[0]))];
}

interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  url: string;
  state: { name: string; type: string } | null;
  completedAt: string | null;
  labels: { nodes: Array<{ name: string }> };
  assignee: { name: string } | null;
  attachments: { nodes: Array<{ url: string; title: string }> };
}

interface LinearPageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

const ISSUES_QUERY = `
  query CompletedIssues($teamId: String, $after: String, $first: Int) {
    issues(
      filter: {
        state: { type: { eq: completed } }
        ${/* We filter server-side if teamId provided */ ""}
      }
      first: $first
      after: $after
      orderBy: updatedAt
    ) {
      nodes {
        id
        identifier
        title
        description
        url
        state { name type }
        completedAt
        labels { nodes { name } }
        assignee { name }
        attachments { nodes { url title } }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

// Server-side team filtering via team-scoped query — efficient, no client-side filtering needed.
const TEAM_ISSUES_QUERY = `
  query TeamCompletedIssues($teamId: String!, $after: String, $first: Int) {
    team(id: $teamId) {
      issues(
        filter: { state: { type: { eq: completed } } }
        first: $first
        after: $after
        orderBy: updatedAt
      ) {
        nodes {
          id
          identifier
          title
          description
          url
          state { name type }
          completedAt
          labels { nodes { name } }
          assignee { name }
          attachments { nodes { url title } }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;

const PROJECT_ISSUES_QUERY = `
  query ProjectCompletedIssues($projectId: String!, $after: String, $first: Int) {
    project(id: $projectId) {
      issues(
        filter: { state: { type: { eq: completed } } }
        first: $first
        after: $after
        orderBy: updatedAt
      ) {
        nodes {
          id
          identifier
          title
          description
          url
          state { name type }
          completedAt
          labels { nodes { name } }
          assignee { name }
          attachments { nodes { url title } }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;

async function graphqlRequest<T>(
  pat: string,
  query: string,
  variables: Record<string, unknown>
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(LINEAR_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${pat}`,
        "User-Agent": "ShipPage/0.1.0",
      },
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
    });

    if (response.status === 401 || response.status === 403) {
      throw new AuthError("Linear authentication failed. Check your PAT.");
    }

    if (response.status === 429) {
      const retryAfter = response.headers.get("X-RateLimit-Reset") ?? "60";
      throw new RateLimitError(`Linear rate limit exceeded. Retry after ${retryAfter}s.`, parseInt(retryAfter, 10));
    }

    if (!response.ok) {
      throw new Error(`Linear API error: ${response.status} ${response.statusText}`);
    }

    const json = (await response.json()) as { data?: T; errors?: Array<{ message: string }> };

    if (json.errors?.length) {
      const messages = json.errors.map((e) => e.message).join("; ");
      throw new Error(`Linear GraphQL errors: ${messages}`);
    }

    if (!json.data) {
      throw new Error("Linear API returned no data.");
    }

    return json.data;
  } finally {
    clearTimeout(timeout);
  }
}

export class AuthError extends Error {
  readonly code = "AUTH_ERROR";
}

export class RateLimitError extends Error {
  readonly code = "RATE_LIMIT";
  constructor(
    message: string,
    public readonly retryAfterSeconds: number
  ) {
    super(message);
  }
}

async function withExponentialBackoff<T>(
  fn: () => Promise<T>,
  maxRetries = 3
): Promise<T> {
  let lastError: Error = new Error("Unknown error");
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof AuthError) throw err; // Don't retry auth failures
      if (err instanceof RateLimitError) {
        const waitMs = err.retryAfterSeconds * 1000;
        await new Promise((r) => setTimeout(r, waitMs));
      } else {
        const backoffMs = Math.pow(2, attempt) * 1000 + Math.random() * 500;
        await new Promise((r) => setTimeout(r, backoffMs));
      }
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }
  throw lastError;
}

function normalizeIssue(issue: LinearIssue): NormalizedTicket {
  const description = issue.description ?? "";
  const attachmentUrls = issue.attachments.nodes.map((a) => a.url).join(" ");
  const searchText = description + " " + attachmentUrls;

  return {
    externalId: issue.identifier,
    source: "linear",
    title: issue.title,
    description: issue.description,
    labels: issue.labels.nodes.map((l) => l.name),
    assignee: issue.assignee?.name ?? null,
    status: issue.state?.name ?? "Unknown",
    url: issue.url,
    completedAt: issue.completedAt,
    linkedPRs: [],
    linkedFigma: extractUrls(searchText, FIGMA_URL_REGEX),
    linkedLoom: extractUrls(searchText, LOOM_URL_REGEX),
    rawData: issue as unknown as Record<string, unknown>,
  };
}

export const linearClient = {
  async testConnection(pat: string): Promise<{ ok: boolean; error?: string }> {
    try {
      await graphqlRequest(pat, "query { viewer { id name } }", {});
      return { ok: true };
    } catch (err) {
      if (err instanceof AuthError) return { ok: false, error: "Authentication failed. Check your Linear PAT." };
      return { ok: false, error: "Could not connect to Linear." };
    }
  },

  async fetchProjects(pat: string): Promise<Array<{ id: string; name: string }>> {
    const [teamsData, projectsData] = await Promise.all([
      withExponentialBackoff(() =>
        graphqlRequest<{ teams: { nodes: Array<{ id: string; name: string }> } }>(
          pat,
          "query { teams { nodes { id name } } }",
          {}
        )
      ),
      withExponentialBackoff(() =>
        graphqlRequest<{
          projects: { nodes: Array<{ id: string; name: string }> };
        }>(
          pat,
          `query { projects(filter: { status: { type: { in: [planned, started] } } }) { nodes { id name } } }`,
          {}
        )
      ).catch(() => ({ projects: { nodes: [] } })), // Projects query may not be available on all plans
    ]);

    const teams = teamsData.teams.nodes.map((t) => ({
      id: `team:${t.id}`,
      name: t.name,
    }));

    const projects = projectsData.projects.nodes.map((p) => ({
      id: `project:${p.id}`,
      name: `[Project] ${p.name}`,
    }));

    return [...teams, ...projects];
  },

  async fetchCompletedTickets(
    pat: string,
    options: { projectId?: string; since?: Date; limit?: number }
  ): Promise<NormalizedTicket[]> {
    type TeamResponse = { team: { issues: { nodes: LinearIssue[]; pageInfo: LinearPageInfo } } };
    type ProjectResponse = { project: { issues: { nodes: LinearIssue[]; pageInfo: LinearPageInfo } } };
    type IssuesResponse = { issues: { nodes: LinearIssue[]; pageInfo: LinearPageInfo } };

    const tickets: NormalizedTicket[] = [];
    const pageSize = Math.min(options.limit ?? 50, 100);
    let cursor: string | null = null;

    // Detect prefix to determine query type
    let queryMode: "team" | "project" | "all" = "all";
    let rawId: string | undefined;

    if (options.projectId) {
      if (options.projectId.startsWith("team:")) {
        queryMode = "team";
        rawId = options.projectId.slice(5);
      } else if (options.projectId.startsWith("project:")) {
        queryMode = "project";
        rawId = options.projectId.slice(8);
      } else {
        // Legacy: treat bare IDs as team IDs for backwards compatibility
        queryMode = "team";
        rawId = options.projectId;
      }
    }

    do {
      const data = await withExponentialBackoff<TeamResponse | ProjectResponse | IssuesResponse>(() => {
        if (queryMode === "team") {
          return graphqlRequest<TeamResponse>(pat, TEAM_ISSUES_QUERY, {
            teamId: rawId,
            first: pageSize,
            after: cursor,
          });
        } else if (queryMode === "project") {
          return graphqlRequest<ProjectResponse>(pat, PROJECT_ISSUES_QUERY, {
            projectId: rawId,
            first: pageSize,
            after: cursor,
          });
        } else {
          return graphqlRequest<IssuesResponse>(pat, ISSUES_QUERY, { first: pageSize, after: cursor });
        }
      });

      let result: { nodes: LinearIssue[]; pageInfo: LinearPageInfo };
      if (queryMode === "team") {
        result = (data as TeamResponse).team.issues;
      } else if (queryMode === "project") {
        result = (data as ProjectResponse).project.issues;
      } else {
        result = (data as IssuesResponse).issues;
      }

      for (const issue of result.nodes) {
        if (options.since && issue.completedAt) {
          const completedDate = new Date(issue.completedAt);
          if (completedDate < options.since) continue;
        }
        tickets.push(normalizeIssue(issue));
      }

      cursor = result.pageInfo.hasNextPage ? result.pageInfo.endCursor : null;

      if (options.limit && tickets.length >= options.limit) break;
    } while (cursor);

    return tickets.slice(0, options.limit);
  },
};
