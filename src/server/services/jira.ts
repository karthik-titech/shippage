import type { NormalizedTicket } from "../../shared/types.js";
import type { JiraIntegrationConfig } from "../../shared/types.js";

// ----------------------------------------------------------------
// Jira API client
//
// IMPORTANT — Two very different auth/API patterns:
//
// Jira Cloud (atlassian.net):
//   - API endpoint: ${baseUrl}/rest/api/3/
//   - Auth: Basic auth with base64(email:api_token) in Authorization header
//   - API token: generated at https://id.atlassian.com/manage-profile/security/api-tokens
//
// Jira Server / Data Center (self-hosted):
//   - API endpoint: ${baseUrl}/rest/api/2/  (v2, not v3)
//   - Auth: Authorization: Bearer ${pat}    (Personal Access Token)
//   - PAT generated in Jira account settings
//
// If users report "401 Unauthorized", this is almost always:
//   1. Wrong API type selected (Cloud vs Server)
//   2. Wrong auth format
// ----------------------------------------------------------------

const REQUEST_TIMEOUT_MS = 30_000;

const FIGMA_URL_REGEX = /https:\/\/(?:www\.)?figma\.com\/(?:file|design|proto)\/[^\s"')>]+/g;
const LOOM_URL_REGEX = /https:\/\/(?:www\.)?loom\.com\/(?:share|embed)\/[^\s"')>]+/g;

function extractUrls(text: string, regex: RegExp): string[] {
  const matches = text.matchAll(regex);
  return [...new Set([...matches].map((m) => m[0]))];
}

function buildAuthHeader(config: JiraIntegrationConfig, pat: string): string {
  if (config.apiType === "cloud") {
    // Jira Cloud: Basic auth with email:api_token
    const credentials = Buffer.from(`${config.email}:${pat}`).toString("base64");
    return `Basic ${credentials}`;
  } else {
    // Jira Server/DC: Bearer token (PAT)
    return `Bearer ${pat}`;
  }
}

function getApiVersion(config: JiraIntegrationConfig): "2" | "3" {
  return config.apiType === "cloud" ? "3" : "2";
}

interface JiraIssue {
  id: string;
  key: string;
  fields: {
    summary: string;
    description: unknown; // v3 uses Atlassian Document Format (ADF), v2 uses plain text
    status: { name: string; statusCategory: { name: string } };
    labels: string[];
    assignee: { displayName: string } | null;
    resolutiondate: string | null;
    updated: string;
    comment?: {
      comments: Array<{ body: string | unknown }>;
    };
  };
  self: string; // API URL for this issue
}

function extractDescriptionText(description: unknown): string | null {
  if (!description) return null;
  if (typeof description === "string") return description;

  // Atlassian Document Format (ADF) — Jira Cloud v3
  // Recursively extract text nodes from the ADF tree
  function extractAdfText(node: unknown): string {
    if (!node || typeof node !== "object") return "";
    const n = node as Record<string, unknown>;
    if (n["type"] === "text" && typeof n["text"] === "string") return n["text"];
    if (Array.isArray(n["content"])) {
      return (n["content"] as unknown[]).map(extractAdfText).join(" ");
    }
    return "";
  }

  return extractAdfText(description) || null;
}

async function jiraFetch<T>(
  config: JiraIntegrationConfig,
  pat: string,
  path: string,
  params?: Record<string, string | number>
): Promise<T> {
  const apiVersion = getApiVersion(config);
  const baseUrl = config.baseUrl.replace(/\/$/, "");
  const url = new URL(`${baseUrl}/rest/api/${apiVersion}${path}`);

  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, String(value));
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url.toString(), {
      headers: {
        Authorization: buildAuthHeader(config, pat),
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "ShipPage/0.1.0",
      },
      signal: controller.signal,
    });

    if (response.status === 401) {
      const hint =
        config.apiType === "cloud"
          ? "For Jira Cloud: use your email + API token (not your password) as Basic auth."
          : "For Jira Server/DC: use a Personal Access Token as Bearer auth.";
      throw new Error(`Jira authentication failed. ${hint}`);
    }

    if (response.status === 403) {
      throw new Error(
        "Jira access denied. Ensure your account has permissions to read the project."
      );
    }

    if (!response.ok) {
      throw new Error(`Jira API error: ${response.status} ${response.statusText}`);
    }

    return (await response.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeJiraIssue(issue: JiraIssue, baseUrl: string): NormalizedTicket {
  const description = extractDescriptionText(issue.fields.description);
  const searchText = description ?? "";
  const commentText = (issue.fields.comment?.comments ?? [])
    .map((c) => (typeof c.body === "string" ? c.body : ""))
    .join(" ");

  return {
    externalId: issue.key,
    source: "jira",
    title: issue.fields.summary,
    description,
    labels: issue.fields.labels,
    assignee: issue.fields.assignee?.displayName ?? null,
    status: issue.fields.status.name,
    url: `${baseUrl}/browse/${issue.key}`,
    completedAt: issue.fields.resolutiondate,
    linkedPRs: [], // Jira doesn't natively expose PR links in standard fields
    linkedFigma: extractUrls(searchText + " " + commentText, FIGMA_URL_REGEX),
    linkedLoom: extractUrls(searchText + " " + commentText, LOOM_URL_REGEX),
    rawData: issue as unknown as Record<string, unknown>,
  };
}

export const jiraClient = {
  async testConnection(
    config: JiraIntegrationConfig,
    pat: string
  ): Promise<{ ok: boolean; error?: string }> {
    try {
      if (config.apiType === "cloud") {
        await jiraFetch(config, pat, "/myself");
      } else {
        await jiraFetch(config, pat, "/serverInfo");
      }
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : "Could not connect to Jira.",
      };
    }
  },

  async fetchProjects(
    config: JiraIntegrationConfig,
    pat: string
  ): Promise<Array<{ id: string; name: string }>> {
    const data = await jiraFetch<Array<{ key: string; name: string }>>(
      config,
      pat,
      "/project/search",
      { maxResults: 100 }
    ).catch(() =>
      jiraFetch<Array<{ key: string; name: string }>>(config, pat, "/project")
    );

    return (Array.isArray(data) ? data : (data as { values?: Array<{ key: string; name: string }> }).values ?? []).map((p) => ({
      id: p.key,
      name: p.name,
    }));
  },

  async fetchCompletedTickets(
    config: JiraIntegrationConfig,
    pat: string,
    options: { projectId?: string; since?: Date; limit?: number }
  ): Promise<NormalizedTicket[]> {
    const tickets: NormalizedTicket[] = [];
    const maxResults = Math.min(options.limit ?? 50, 100);
    let startAt = 0;
    let total = Infinity;

    // Build JQL query
    // SECURITY NOTE: projectId comes from user selection (a validated project key).
    // We still sanitize it here as a defense-in-depth measure.
    const projectFilter = options.projectId
      ? `project = "${options.projectId.replace(/[^A-Z0-9_-]/gi, "")}" AND `
      : "";
    const sinceFilter = options.since
      ? ` AND updated >= "${options.since.toISOString().split("T")[0]}"`
      : "";
    const jql = `${projectFilter}statusCategory = Done${sinceFilter} ORDER BY updated DESC`;

    while (tickets.length < total) {
      const data = await jiraFetch<{
        issues: JiraIssue[];
        total: number;
        startAt: number;
        maxResults: number;
      }>(config, pat, "/search", {
        jql,
        startAt,
        maxResults,
        fields: "summary,description,status,labels,assignee,resolutiondate,updated,comment",
      });

      total = data.total;

      for (const issue of data.issues) {
        tickets.push(normalizeJiraIssue(issue, config.baseUrl));
      }

      startAt += data.issues.length;

      if (data.issues.length < maxResults) break;
      if (options.limit && tickets.length >= options.limit) break;
    }

    return tickets.slice(0, options.limit);
  },
};
