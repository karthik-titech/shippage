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

// ⚠️ Linear's GraphQL doesn't support filtering by teamId directly in the filter.
// We fetch all completed issues and filter client-side when teamId is provided.
// This is inefficient for large teams. A better approach for v2: use team-scoped queries.
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
    const data = await withExponentialBackoff(() =>
      graphqlRequest<{ teams: { nodes: Array<{ id: string; name: string }> } }>(
        pat,
        "query { teams { nodes { id name } } }",
        {}
      )
    );
    return data.teams.nodes;
  },

  async fetchCompletedTickets(
    pat: string,
    options: { projectId?: string; since?: Date; limit?: number }
  ): Promise<NormalizedTicket[]> {
    const tickets: NormalizedTicket[] = [];
    const pageSize = Math.min(options.limit ?? 50, 100);
    let cursor: string | null = null;

    do {
      const data = await withExponentialBackoff(() => {
        if (options.projectId) {
          return graphqlRequest<{
            team: { issues: { nodes: LinearIssue[]; pageInfo: LinearPageInfo } };
          }>(pat, TEAM_ISSUES_QUERY, {
            teamId: options.projectId,
            first: pageSize,
            after: cursor,
          });
        } else {
          return graphqlRequest<{
            issues: { nodes: LinearIssue[]; pageInfo: LinearPageInfo };
          }>(pat, ISSUES_QUERY, { first: pageSize, after: cursor });
        }
      });

      const result = options.projectId
        ? (data as { team: { issues: { nodes: LinearIssue[]; pageInfo: LinearPageInfo } } }).team.issues
        : (data as { issues: { nodes: LinearIssue[]; pageInfo: LinearPageInfo } }).issues;

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
