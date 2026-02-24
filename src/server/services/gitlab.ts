import type { NormalizedTicket } from "../../shared/types.js";

// ----------------------------------------------------------------
// GitLab API client
// Uses GitLab REST API v4: ${baseUrl}/api/v4
// Auth: PRIVATE-TOKEN: ${pat}
// ----------------------------------------------------------------

const DEFAULT_BASE_URL = "https://gitlab.com";
const REQUEST_TIMEOUT_MS = 30_000;

const FIGMA_URL_REGEX = /https:\/\/(?:www\.)?figma\.com\/(?:file|design|proto)\/[^\s"')>]+/g;
const LOOM_URL_REGEX = /https:\/\/(?:www\.)?loom\.com\/(?:share|embed)\/[^\s"')>]+/g;

function extractUrls(text: string, regex: RegExp): string[] {
  const matches = text.matchAll(regex);
  return [...new Set([...matches].map((m) => m[0]))];
}

interface GitLabIssue {
  iid: number;
  title: string;
  description: string | null;
  web_url: string;
  state: string;
  closed_at: string | null;
  labels: string[];
  assignee: { name: string } | null;
  project_id: number;
}

interface GitLabProject {
  id: number;
  name: string;
  path_with_namespace: string;
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
      if (err instanceof AuthError) throw err;
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

async function gitlabFetch<T>(pat: string, url: string): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: {
        "PRIVATE-TOKEN": pat,
        "User-Agent": "ShipPage/0.1.0",
      },
      signal: controller.signal,
    });

    if (response.status === 401 || response.status === 403) {
      throw new AuthError("GitLab authentication failed. Check your PAT.");
    }

    if (response.status === 429) {
      const retryAfter = response.headers.get("Retry-After") ?? "60";
      throw new RateLimitError(
        `GitLab rate limit exceeded. Retry after ${retryAfter}s.`,
        parseInt(retryAfter, 10)
      );
    }

    if (!response.ok) {
      throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
    }

    return (await response.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchAllPages<T>(pat: string, initialUrl: string): Promise<T[]> {
  const items: T[] = [];
  let url: string | null = initialUrl;

  while (url) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        headers: {
          "PRIVATE-TOKEN": pat,
          "User-Agent": "ShipPage/0.1.0",
        },
        signal: controller.signal,
      });

      if (response.status === 401 || response.status === 403) {
        throw new AuthError("GitLab authentication failed. Check your PAT.");
      }

      if (!response.ok) {
        throw new Error(`GitLab API error: ${response.status}`);
      }

      const data = (await response.json()) as T[];
      items.push(...data);

      // Parse Link header for next page
      const linkHeader = response.headers.get("Link") ?? "";
      const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
      url = nextMatch?.[1] ?? null;
    } finally {
      clearTimeout(timeout);
    }
  }

  return items;
}

export const gitlabClient = {
  async testConnection(pat: string, baseUrl = DEFAULT_BASE_URL): Promise<{ ok: boolean; error?: string }> {
    try {
      await gitlabFetch(pat, `${baseUrl}/api/v4/user`);
      return { ok: true };
    } catch (err) {
      if (err instanceof AuthError) {
        return { ok: false, error: "Authentication failed. Check your GitLab PAT." };
      }
      return { ok: false, error: "Could not connect to GitLab." };
    }
  },

  async fetchProjects(
    pat: string,
    baseUrl = DEFAULT_BASE_URL
  ): Promise<Array<{ id: string; name: string }>> {
    return withExponentialBackoff(async () => {
      const projects = await fetchAllPages<GitLabProject>(
        pat,
        `${baseUrl}/api/v4/projects?membership=true&min_access_level=20&per_page=100&order_by=last_activity_at`
      );
      return projects.map((p) => ({
        id: String(p.id),
        name: p.path_with_namespace,
      }));
    });
  },

  async fetchCompletedTickets(
    pat: string,
    options: {
      projectId: string; // numeric project ID as string
      since?: Date;
      limit?: number;
      baseUrl?: string;
    }
  ): Promise<NormalizedTicket[]> {
    const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    const encodedId = encodeURIComponent(options.projectId);

    const sinceParam = options.since
      ? `&updated_after=${options.since.toISOString()}`
      : "";
    const perPage = Math.min(options.limit ?? 100, 100);

    const issues = await withExponentialBackoff(() =>
      fetchAllPages<GitLabIssue>(
        pat,
        `${baseUrl}/api/v4/projects/${encodedId}/issues?state=closed&per_page=${perPage}${sinceParam}`
      )
    );

    const tickets: NormalizedTicket[] = [];

    // Fetch the project path for constructing externalId
    let projectPath = options.projectId;
    try {
      const project = await gitlabFetch<GitLabProject>(
        pat,
        `${baseUrl}/api/v4/projects/${encodedId}`
      );
      projectPath = project.path_with_namespace;
    } catch {
      // Fall back to numeric ID if project fetch fails
    }

    for (const issue of issues) {
      const description = issue.description ?? "";

      tickets.push({
        externalId: `${projectPath}#${issue.iid}`,
        source: "gitlab",
        title: issue.title,
        description: issue.description,
        labels: issue.labels,
        assignee: issue.assignee?.name ?? null,
        status: "closed",
        url: issue.web_url,
        completedAt: issue.closed_at,
        linkedPRs: [],
        linkedFigma: extractUrls(description, FIGMA_URL_REGEX),
        linkedLoom: extractUrls(description, LOOM_URL_REGEX),
        rawData: issue as unknown as Record<string, unknown>,
      });

      if (options.limit && tickets.length >= options.limit) break;
    }

    return tickets;
  },
};
