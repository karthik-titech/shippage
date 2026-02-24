import type { NormalizedTicket, GeneratedReleasePage } from "../../shared/types.js";

// ----------------------------------------------------------------
// Notion API client
// DUAL ROLE: ticket source (databases) + export target (pages)
// Auth: Authorization: Bearer ${token}
//       Notion-Version: 2022-06-28
// ----------------------------------------------------------------

const NOTION_API_URL = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";
const REQUEST_TIMEOUT_MS = 30_000;

const FIGMA_URL_REGEX = /https:\/\/(?:www\.)?figma\.com\/(?:file|design|proto)\/[^\s"')>]+/g;
const LOOM_URL_REGEX = /https:\/\/(?:www\.)?loom\.com\/(?:share|embed)\/[^\s"')>]+/g;

function extractUrls(text: string, regex: RegExp): string[] {
  const matches = text.matchAll(regex);
  return [...new Set([...matches].map((m) => m[0]))];
}

interface NotionRichText {
  plain_text: string;
}

interface NotionPage {
  id: string;
  url: string;
  properties: Record<string, NotionProperty>;
  created_time: string;
  last_edited_time: string;
}

type NotionTitleProp = { type: "title"; title: NotionRichText[] };
type NotionRichTextProp = { type: "rich_text"; rich_text: NotionRichText[] };
type NotionStatusProp = { type: "status"; status: { name: string } | null };
type NotionSelectProp = { type: "select"; select: { name: string } | null };
type NotionMultiSelectProp = { type: "multi_select"; multi_select: Array<{ name: string }> };
type NotionPeopleProp = { type: "people"; people: Array<{ name?: string }> };
type NotionDateProp = { type: "date"; date: { start: string } | null };

type NotionProperty =
  | NotionTitleProp
  | NotionRichTextProp
  | NotionStatusProp
  | NotionSelectProp
  | NotionMultiSelectProp
  | NotionPeopleProp
  | NotionDateProp
  | { type: string; [key: string]: unknown };

interface NotionDatabase {
  id: string;
  title: NotionRichText[];
}

async function notionFetch<T>(
  token: string,
  path: string,
  options?: { method?: string; body?: unknown }
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${NOTION_API_URL}${path}`, {
      method: options?.method ?? "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
        "User-Agent": "ShipPage/0.1.0",
      },
      body: options?.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });

    if (response.status === 401 || response.status === 403) {
      throw new Error("Notion authentication failed. Check your integration token.");
    }

    if (response.status === 429) {
      const retryAfter = response.headers.get("Retry-After") ?? "60";
      throw new Error(`Notion rate limit exceeded. Retry after ${retryAfter}s.`);
    }

    if (!response.ok) {
      throw new Error(`Notion API error: ${response.status} ${response.statusText}`);
    }

    return (await response.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

function getTextFromProperty(prop: NotionProperty | undefined): string {
  if (!prop) return "";
  if (prop.type === "title") return (prop as NotionTitleProp).title.map((r) => r.plain_text).join("");
  if (prop.type === "rich_text") return (prop as NotionRichTextProp).rich_text.map((r) => r.plain_text).join("");
  return "";
}

function getStatusFromProperty(prop: NotionProperty | undefined): string | null {
  if (!prop) return null;
  if (prop.type === "status") return (prop as NotionStatusProp).status?.name ?? null;
  if (prop.type === "select") return (prop as NotionSelectProp).select?.name ?? null;
  return null;
}

function getLabelsFromProperty(prop: NotionProperty | undefined): string[] {
  if (!prop || prop.type !== "multi_select") return [];
  return (prop as NotionMultiSelectProp).multi_select.map((s) => s.name);
}

function getAssigneeFromProperty(prop: NotionProperty | undefined): string | null {
  if (!prop || prop.type !== "people") return null;
  return (prop as NotionPeopleProp).people[0]?.name ?? null;
}

function getDateFromProperty(prop: NotionProperty | undefined): string | null {
  if (!prop || prop.type !== "date") return null;
  return (prop as NotionDateProp).date?.start ?? null;
}

// Check if a status value indicates "done"
const DONE_STATUS_PATTERNS = /done|complete|closed|shipped|resolved|finished/i;

function isDoneStatus(value: string): boolean {
  return DONE_STATUS_PATTERNS.test(value);
}

export const notionClient = {
  async testConnection(token: string): Promise<{ ok: boolean; error?: string }> {
    try {
      await notionFetch(token, "/users/me");
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not connect to Notion.";
      return { ok: false, error: message };
    }
  },

  async fetchProjects(token: string): Promise<Array<{ id: string; name: string }>> {
    const results: Array<{ id: string; name: string }> = [];
    let cursor: string | undefined;

    do {
      const body: Record<string, unknown> = {
        filter: { value: "database", property: "object" },
        page_size: 100,
      };
      if (cursor) body.start_cursor = cursor;

      const data = await notionFetch<{
        results: NotionDatabase[];
        has_more: boolean;
        next_cursor: string | null;
      }>(token, "/search", { method: "POST", body });

      for (const db of data.results) {
        const name = db.title.map((r) => r.plain_text).join("") || "(Untitled database)";
        results.push({ id: db.id, name });
      }

      cursor = data.has_more && data.next_cursor ? data.next_cursor : undefined;
    } while (cursor);

    return results;
  },

  // Fetch pages accessible to the integration — used as publish targets
  async fetchParentPages(token: string): Promise<Array<{ id: string; name: string }>> {
    const results: Array<{ id: string; name: string }> = [];
    let cursor: string | undefined;

    do {
      const body: Record<string, unknown> = {
        filter: { value: "page", property: "object" },
        page_size: 50,
      };
      if (cursor) body.start_cursor = cursor;

      const data = await notionFetch<{
        results: Array<{ id: string; properties: Record<string, NotionProperty> }>;
        has_more: boolean;
        next_cursor: string | null;
      }>(token, "/search", { method: "POST", body });

      for (const page of data.results) {
        const titleProp = Object.values(page.properties).find((p) => p.type === "title") as
          | NotionTitleProp
          | undefined;
        const name = titleProp
          ? titleProp.title.map((r) => r.plain_text).join("")
          : "(Untitled page)";
        results.push({ id: page.id, name: name || "(Untitled page)" });
      }

      cursor = data.has_more && data.next_cursor ? data.next_cursor : undefined;
    } while (cursor && results.length < 100);

    return results;
  },

  async fetchCompletedTickets(
    token: string,
    options: {
      projectId: string; // database ID
      since?: Date;
      limit?: number;
    }
  ): Promise<NormalizedTicket[]> {
    const tickets: NormalizedTicket[] = [];
    let cursor: string | undefined;

    // First, get the database schema to understand properties
    const db = await notionFetch<{ properties: Record<string, { type: string; name: string }> }>(
      token,
      `/databases/${options.projectId}`
    );

    // Find "status"-like property names
    const statusPropName = Object.keys(db.properties).find((k) =>
      /^(status|state|stage)$/i.test(k)
    );

    // Find "completed date" property
    const completedDatePropName = Object.keys(db.properties).find((k) =>
      /^(completed|done date|closed at|completion date)$/i.test(k)
    );

    do {
      const body: Record<string, unknown> = {
        page_size: Math.min(options.limit ?? 100, 100),
      };
      if (cursor) body.start_cursor = cursor;

      const data = await notionFetch<{
        results: NotionPage[];
        has_more: boolean;
        next_cursor: string | null;
      }>(token, `/databases/${options.projectId}/query`, { method: "POST", body });

      for (const page of data.results) {
        const props = page.properties;

        // Get title from the title property
        const titleProp = Object.values(props).find((p) => p.type === "title") as
          | Extract<NotionProperty, { type: "title" }>
          | undefined;
        const title = titleProp ? titleProp.title.map((r) => r.plain_text).join("") : "(Untitled)";

        // Get status — skip if not done (when we can determine it)
        const statusValue = statusPropName
          ? getStatusFromProperty(props[statusPropName])
          : null;

        if (statusValue !== null && !isDoneStatus(statusValue)) {
          continue; // Skip non-done items when we can detect status
        }

        // Get description from first rich_text property
        const descPropName = Object.keys(props).find((k) => {
          const p = props[k];
          return p && p.type === "rich_text" && !["status", "state"].includes(k.toLowerCase());
        });
        const description = descPropName ? getTextFromProperty(props[descPropName]) : null;

        // Get labels from multi_select
        const labelsPropName = Object.keys(props).find(
          (k) => props[k] && props[k].type === "multi_select"
        );
        const labels = labelsPropName ? getLabelsFromProperty(props[labelsPropName]) : [];

        // Get assignee
        const assigneePropName = Object.keys(props).find(
          (k) => props[k] && props[k].type === "people"
        );
        const assignee = assigneePropName ? getAssigneeFromProperty(props[assigneePropName]) : null;

        // Get completed date
        const completedAt = completedDatePropName
          ? getDateFromProperty(props[completedDatePropName])
          : null;

        // Apply since filter
        if (options.since && completedAt) {
          if (new Date(completedAt) < options.since) continue;
        }

        const descText = description ?? "";

        tickets.push({
          externalId: page.id,
          source: "notion",
          title,
          description: description || null,
          labels,
          assignee,
          status: statusValue ?? "done",
          url: page.url,
          completedAt,
          linkedPRs: [],
          linkedFigma: extractUrls(descText, FIGMA_URL_REGEX),
          linkedLoom: extractUrls(descText, LOOM_URL_REGEX),
          rawData: page as unknown as Record<string, unknown>,
        });

        if (options.limit && tickets.length >= options.limit) break;
      }

      cursor =
        data.has_more && data.next_cursor && (!options.limit || tickets.length < options.limit)
          ? data.next_cursor
          : undefined;
    } while (cursor);

    return tickets.slice(0, options.limit);
  },

  // Export target: publish a release page to Notion
  async publishReleasePage(
    token: string,
    parentPageId: string,
    release: GeneratedReleasePage & { version: string; title?: string }
  ): Promise<{ url: string }> {
    const blocks: unknown[] = [
      // Headline
      {
        object: "block",
        type: "heading_1",
        heading_1: {
          rich_text: [{ type: "text", text: { content: release.headline } }],
        },
      },
      // Intro
      {
        object: "block",
        type: "paragraph",
        paragraph: {
          rich_text: [{ type: "text", text: { content: release.intro } }],
        },
      },
    ];

    // Sections
    for (const section of release.sections) {
      blocks.push({
        object: "block",
        type: "heading_2",
        heading_2: {
          rich_text: [{ type: "text", text: { content: section.title } }],
        },
      });

      for (const item of section.items) {
        // Item title as bulleted list item
        blocks.push({
          object: "block",
          type: "bulleted_list_item",
          bulleted_list_item: {
            rich_text: [
              {
                type: "text",
                text: { content: item.title },
                annotations: { bold: true },
              },
              ...(item.description
                ? [
                    {
                      type: "text",
                      text: { content: ` — ${item.description}` },
                    },
                  ]
                : []),
            ],
          },
        });
      }
    }

    // CTA
    if (release.cta?.text && release.cta?.url) {
      blocks.push({
        object: "block",
        type: "paragraph",
        paragraph: {
          rich_text: [
            {
              type: "text",
              text: { content: release.cta.text, link: { url: release.cta.url } },
            },
          ],
        },
      });
    }

    const pageTitle = release.title ?? release.headline ?? `Release ${release.version}`;

    const page = await notionFetch<{ id: string; url: string }>(token, "/pages", {
      method: "POST",
      body: {
        parent: { page_id: parentPageId },
        properties: {
          title: {
            title: [{ type: "text", text: { content: pageTitle } }],
          },
        },
        children: blocks,
      },
    });

    return { url: page.url };
  },
};
