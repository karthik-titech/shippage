import type { NormalizedTicket } from "../../shared/types.js";

// ----------------------------------------------------------------
// GitHub Issues API client
// Uses GitHub REST API v3
// Auth: Authorization: Bearer ${pat}
//
// IMPORTANT — Required PAT scopes:
//   - Private repos: repo (full control of private repositories)
//   - Public repos: public_repo
//   - Organization repos: read:org
// Fine-grained PATs need: Issues (read), Pull requests (read)
//
// Rate limits:
//   - Authenticated: 5,000 requests/hour
//   - Timeline API adds 1 request per issue (for linked PRs)
//   - For 100 issues, expect ~200 API calls
// ----------------------------------------------------------------

const DEFAULT_BASE_URL = "https://api.github.com";
const REQUEST_TIMEOUT_MS = 30_000;

const FIGMA_URL_REGEX = /https:\/\/(?:www\.)?figma\.com\/(?:file|design|proto)\/[^\s"')>]+/g;
const LOOM_URL_REGEX = /https:\/\/(?:www\.)?loom\.com\/(?:share|embed)\/[^\s"')>]+/g;
const PR_URL_REGEX = /https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+/g;

function extractUrls(text: string, regex: RegExp): string[] {
  const matches = text.matchAll(regex);
  return [...new Set([...matches].map((m) => m[0]))];
}

interface GitHubIssue {
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  state: string;
  closed_at: string | null;
  labels: Array<{ name: string }>;
  assignee: { login: string } | null;
  pull_request?: { url: string }; // Issues with this field ARE pull requests — skip them
}

interface GitHubTimelineEvent {
  event: string;
  source?: {
    type: string;
    issue?: {
      pull_request?: { url: string; html_url: string };
    };
  };
}

async function githubFetch<T>(
  pat: string,
  url: string,
  options?: { suppressErrors?: boolean }
): Promise<T | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${pat}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "ShipPage/0.1.0",
      },
      signal: controller.signal,
    });

    if (response.status === 401 || response.status === 403) {
      throw new Error(
        "GitHub authentication failed. Check your PAT and ensure it has the required scopes (repo or public_repo)."
      );
    }

    if (response.status === 429 || response.status === 403) {
      const resetTime = response.headers.get("X-RateLimit-Reset");
      if (resetTime) {
        const waitSeconds = Math.max(0, parseInt(resetTime, 10) - Math.floor(Date.now() / 1000));
        throw new Error(`GitHub rate limit exceeded. Resets in ${waitSeconds}s.`);
      }
    }

    if (response.status === 404) {
      if (options?.suppressErrors) return null;
      throw new Error(
        `GitHub resource not found: ${url}. ` +
          `Check that the owner/repo exists and your PAT has access.`
      );
    }

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
    }

    return (await response.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchAllPages<T>(
  pat: string,
  initialUrl: string
): Promise<T[]> {
  const items: T[] = [];
  let url: string | null = initialUrl;

  while (url) {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${pat}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "ShipPage/0.1.0",
      },
    });

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status}`);
    }

    const data = (await response.json()) as T[];
    items.push(...data);

    // Parse Link header for next page
    const linkHeader = response.headers.get("Link") ?? "";
    const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
    url = nextMatch?.[1] ?? null;
  }

  return items;
}

async function getLinkedPRs(
  pat: string,
  baseUrl: string,
  owner: string,
  repo: string,
  issueNumber: number
): Promise<string[]> {
  // The Timeline API is the most reliable way to find linked PRs
  // It costs one extra API request per issue
  const events = await githubFetch<GitHubTimelineEvent[]>(
    pat,
    `${baseUrl}/repos/${owner}/${repo}/issues/${issueNumber}/timeline`,
    { suppressErrors: true }
  );

  if (!events) return [];

  return events
    .filter(
      (e) =>
        e.event === "cross-referenced" &&
        e.source?.type === "issue" &&
        e.source.issue?.pull_request?.html_url
    )
    .map((e) => e.source!.issue!.pull_request!.html_url);
}

export const githubClient = {
  async testConnection(pat: string, baseUrl = DEFAULT_BASE_URL): Promise<{ ok: boolean; error?: string }> {
    try {
      await githubFetch(pat, `${baseUrl}/user`);
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: "Authentication failed. Check your GitHub PAT and required scopes.",
      };
    }
  },

  async fetchProjects(
    pat: string,
    baseUrl = DEFAULT_BASE_URL,
    owner?: string
  ): Promise<Array<{ id: string; name: string }>> {
    if (owner) {
      // Fetch repos for a specific owner (user or org)
      const userRepos = await fetchAllPages<{ full_name: string; name: string }>(
        pat,
        `${baseUrl}/users/${owner}/repos?type=all&per_page=100&sort=updated`
      );
      const orgRepos = await fetchAllPages<{ full_name: string; name: string }>(
        pat,
        `${baseUrl}/orgs/${owner}/repos?type=all&per_page=100&sort=updated`
      ).catch(() => []); // Might fail if owner is a user not an org
      return [...userRepos, ...orgRepos].map((r) => ({
        id: r.full_name,
        name: r.full_name,
      }));
    }

    // No owner: fetch repos the authenticated user has access to
    const repos = await fetchAllPages<{ full_name: string; name: string }>(
      pat,
      `${baseUrl}/user/repos?type=all&per_page=100&sort=updated`
    );
    return repos.map((r) => ({ id: r.full_name, name: r.full_name }));
  },

  async fetchCompletedTickets(
    pat: string,
    options: {
      projectId: string; // "owner/repo" format
      since?: Date;
      limit?: number;
      baseUrl?: string;
      fetchLinkedPRs?: boolean;
    }
  ): Promise<NormalizedTicket[]> {
    const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    const [owner, repo] = options.projectId.split("/");
    if (!owner || !repo) {
      throw new Error(
        `Invalid GitHub project ID: "${options.projectId}". Expected format: "owner/repo"`
      );
    }

    const sinceParam = options.since ? `&since=${options.since.toISOString()}` : "";
    const perPage = Math.min(options.limit ?? 100, 100);

    const issues = await fetchAllPages<GitHubIssue>(
      pat,
      `${baseUrl}/repos/${owner}/${repo}/issues?state=closed&per_page=${perPage}${sinceParam}`
    );

    const tickets: NormalizedTicket[] = [];

    for (const issue of issues) {
      // Skip pull requests (GitHub returns PRs as issues in this endpoint)
      if (issue.pull_request) continue;
      if (issue.state !== "closed") continue;

      const body = issue.body ?? "";
      const linkedPRsFromBody = extractUrls(body, PR_URL_REGEX);

      // Only fetch timeline for linked PRs if explicitly requested
      // (to conserve API rate limit budget)
      let linkedPRs = linkedPRsFromBody;
      if (options.fetchLinkedPRs) {
        const timelinePRs = await getLinkedPRs(pat, baseUrl, owner, repo, issue.number).catch(
          () => []
        );
        linkedPRs = [...new Set([...linkedPRsFromBody, ...timelinePRs])];
      }

      tickets.push({
        externalId: `${repo}#${issue.number}`,
        source: "github",
        title: issue.title,
        description: issue.body,
        labels: issue.labels.map((l) => l.name),
        assignee: issue.assignee?.login ?? null,
        status: "closed",
        url: issue.html_url,
        completedAt: issue.closed_at,
        linkedPRs,
        linkedFigma: extractUrls(body, FIGMA_URL_REGEX),
        linkedLoom: extractUrls(body, LOOM_URL_REGEX),
        rawData: issue as unknown as Record<string, unknown>,
      });

      if (options.limit && tickets.length >= options.limit) break;
    }

    return tickets;
  },
};
