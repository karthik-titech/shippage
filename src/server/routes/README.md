# src/server/routes/ — REST API Route Handlers

All routes are mounted under `/api/` and protected by CSRF middleware (except `GET /api/csrf-token`).

## Route map

```
GET    /api/csrf-token                       Return the CSRF token (no auth required)
GET    /api/config                           Return current config (secrets redacted)
PATCH  /api/config                           Update config values
POST   /api/integrations/test                Test integration credentials
GET    /api/integrations/projects            List projects for a source
GET    /api/integrations/tickets             Fetch completed tickets
POST   /api/generate                         Generate a release page (calls Claude)
POST   /api/generate/:id/rerender            Re-render HTML with a new template
GET    /api/releases                         List releases (filterable, paginated)
GET    /api/releases/:id                     Get single release
PATCH  /api/releases/:id                     Update release (content, title, status)
DELETE /api/releases/:id                     Delete release
GET    /api/releases/:id/tickets             Ticket snapshots for a release
GET    /api/releases/:id/history             AI generation history for a release
POST   /api/export                           Export release to file system
GET    /api/export/:id/html                  Get raw HTML for a release
GET    /api/export/templates                 List available templates
```

---

## config.ts

Handles user preferences and settings.

**`GET /api/config`**
- Reads `~/.shippage/config.json` via `readConfig()`
- Removes all secret fields (PATs, API keys) before responding
- Returns `{ config: ValidatedConfig }`

**`PATCH /api/config`**
- Validates body with Zod (partial ShipPageConfigSchema)
- Deep-merges with existing config
- Writes back with `chmod 0600`

---

## integrations.ts

Dispatches to the appropriate service (Linear, GitHub, or Jira) based on the `source` query/body parameter.

**`POST /api/integrations/test`**
- Body: `{ source: "linear"|"github"|"jira", credentials: {...} }`
- Returns `{ ok: boolean, error?: string }`
- Credentials are validated but **never stored** by this endpoint

**`GET /api/integrations/projects`**
- Query: `?source=linear` (or github/jira)
- Returns `{ projects: [{ id, name }] }`

**`GET /api/integrations/tickets`**
- Query: `?source=linear&projectId=...&since=...&limit=...`
- Returns `{ tickets: NormalizedTicket[], count: N }`

---

## generate.ts

The most complex route — orchestrates ticket snapshots, AI generation, and template rendering.

**`POST /api/generate`**

```
1. Validate body: { source, projectName, version, template, ticketIds[], preferences }
2. Create release record in DB (status: "draft")
3. snapshotTickets(releaseId, selectedTickets) → store sanitized copies
4. generateReleasePage(tickets, version, preferences, model, apiKey)
   └── Calls Claude → returns GeneratedReleasePage JSON
5. renderTemplate(template, { ...generatedContent, brandColor, companyName, ... })
   └── Returns HTML string
6. updateRelease(id, { generatedContent, generatedHtml })
7. recordGeneration(id, { tokensInput, tokensOutput, durationMs, ... })
8. Return { release, tokensUsed }
```

**`POST /api/generate/:id/rerender`**
- Body: `{ template: string }`
- Re-renders stored `generatedContent` with a different template (no Claude call)
- Useful for switching between minimal/changelog/feature-launch layouts

---

## releases.ts

Standard CRUD for the releases table.

**`PATCH /api/releases/:id`** — the interesting one:
- If `content` is provided (edited in the UI), re-renders HTML by calling `renderTemplate()` inline
- This keeps the stored `generated_html` in sync with the `generated_content` JSON at all times

---

## export.ts

**`POST /api/export`**
- Body: `{ releaseId, mode: "single-file" | "folder" }`
- Calls `exportRelease()` from `html-exporter.ts`
- Returns `{ path, filename, sizeBytes }`

**`GET /api/export/:id/html`**
- Returns the raw `generated_html` field as `text/html`
- Used by the Editor page's iframe preview (sandboxed with `allow-same-origin`)

**`GET /api/export/templates`**
- Returns `{ templates: [{ name, source: "builtin" | "user" }] }`
- Source of truth for the template picker in the Editor UI
