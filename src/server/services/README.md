# src/server/services/ — Business Logic Layer

Each file in this directory encapsulates one domain. Routes call services; services do not call routes.

---

## ai-generator.ts — AI Release Page Generation

**Why it exists:** Translates a list of raw tickets into a structured, user-facing release page using Claude.

### Key exports

| Export | Description |
|--------|-------------|
| `generateReleasePage(options)` | Main entry point. Returns `GenerationResult` with content + usage metadata |
| `estimateInputTokens(tickets)` | Rough token count for UI cost estimates (~150 tokens/ticket + 500 boilerplate) |

### Algorithm

```
1. sanitizeForPrompt(text)
   └── Strip XML-like tags from all user-supplied ticket fields
       (defense-in-depth against prompt injection)

2. buildPrompt(options)
   └── Assemble the user-turn prompt:
       ├── Context block: company name, version, tone, brand color
       ├── <ticket_data> XML block: all sanitized tickets
       └── Output format: strict JSON schema definition

3. client.messages.create(model, system_prompt, user_prompt)
   ├── On Anthropic.NotFoundError (404):
   │   └── Throw human-readable deprecation error with update instructions
   └── On success: proceed to step 4

4. extractJson(responseText)
   ├── Try: direct JSON (starts with "{")
   ├── Try: JSON inside markdown code fence (```json ... ```)
   └── Fallback: regex for first {...} block

5. parseGeneratedContent(json)
   └── Validate shape: headline (string), intro (string), sections (array)

6. If JSON parse fails → retry once with stricter suffix in prompt
   └── If retry also fails → throw descriptive error
```

### Security

- **Prompt injection**: All ticket data wrapped in `<ticket_data>` XML tags. System prompt instructs Claude to treat that block as structured data only, never as instructions.
- **API key handling**: Key is passed per-call; never stored in module scope; never logged.
- **Model deprecation**: `Anthropic.NotFoundError` is caught and converted to a user-actionable message.

### Configuration

- Default model: `claude-sonnet-4-6` (user-configurable in config.json)
- Max output tokens: 8,192
- Temperature: 0.3 (deterministic but not rigid)
- Retry limit: 1 retry on JSON parse failure

---

## linear.ts — Linear GraphQL Integration

**Why it exists:** Linear uses GraphQL, not REST. This service handles authentication, project listing, ticket fetching, and media URL extraction.

### Key exports

| Export | Description |
|--------|-------------|
| `linearClient.testConnection(pat)` | Validates PAT via `viewer` query. Returns `{ ok, error }` |
| `linearClient.fetchProjects(pat)` | Lists all teams the PAT has access to |
| `linearClient.fetchCompletedTickets(pat, opts)` | Returns completed issues as `NormalizedTicket[]` |

### Algorithm — fetchCompletedTickets

```
1. GraphQL query to team.issues with filter:
   └── state.type: "completed", completedAt: since (default 90 days)

2. For each issue node:
   ├── extractUrls(description):
   │   ├── Figma: /figma\.com\/(file|design|proto)\//
   │   └── Loom:  /loom\.com\/share\//
   ├── Map to NormalizedTicket (common interface shared with GitHub + Jira)
   └── Sanitize-html strips HTML from title/description before return

3. Cursor-based pagination:
   └── pageInfo.hasNextPage + pageInfo.endCursor → repeat until done or limit reached
```

### NormalizedTicket interface

All three integrations return the same shape so the AI generator and DB layer don't need to know which source was used:

```typescript
{
  externalId, source, title, description,
  labels, assignee, status, url,
  linkedFigma[], linkedLoom[], rawData
}
```

---

## github.ts — GitHub Issues Integration

**Why it exists:** GitHub Issues uses REST (not GraphQL). Pull requests and issues are separate resources; this service correlates them.

### Key exports

| Export | Description |
|--------|-------------|
| `githubClient.testConnection(pat, baseUrl?)` | `GET /user` to validate the PAT |
| `githubClient.fetchProjects(pat, baseUrl?)` | Lists repos the PAT can read |
| `githubClient.fetchCompletedTickets(pat, opts)` | Returns closed issues as `NormalizedTicket[]` |

### Algorithm — fetchCompletedTickets

```
1. GET /repos/{owner}/{repo}/issues?state=closed&since=...
   └── Auth: "Authorization: Bearer {pat}"
   └── Rate limit: 5,000 req/hour for authenticated requests

2. For each issue:
   ├── Skip pull_request issues (GitHub returns PRs in issues endpoint)
   ├── Extract Figma/Loom URLs from body
   └── Map to NormalizedTicket

3. Pagination via Link header (rel="next" pattern)
   └── Parse Link header → extract next page URL → repeat
```

### GitHub Enterprise support

`baseUrl` defaults to `https://api.github.com`. GitHub Enterprise customers supply their own `baseUrl` (must be HTTPS, validated by the config schema).

---

## jira.ts — Jira Cloud + Server Integration

**Why it exists:** Jira Cloud and Jira Server/Data Center have different API versions and different authentication schemes. This service abstracts both.

### Key exports

| Export | Description |
|--------|-------------|
| `jiraClient.testConnection(config)` | Validates credentials for the configured API type |
| `jiraClient.fetchProjects(config)` | Lists accessible Jira projects |
| `jiraClient.fetchCompletedTickets(config, opts)` | JQL-filtered completed issues as `NormalizedTicket[]` |

### Cloud vs Server distinction

| | Jira Cloud | Jira Server / Data Center |
|-|-----------|--------------------------|
| API path | `/rest/api/3/` | `/rest/api/2/` |
| Auth | Basic `email:api-token` (Base64) | Bearer PAT |
| Issue format | Rich text (ADF) | Plain text |

```
apiType === "cloud"
  ├── endpoint: /rest/api/3/search
  └── Authorization: Basic base64(email:token)

apiType === "server"
  ├── endpoint: /rest/api/2/search
  └── Authorization: Bearer {pat}
```

### Ticket query

Uses JQL: `project = {projectId} AND status in (Done, Closed, Resolved) ORDER BY updated DESC`

Pagination via `startAt` + `maxResults` (Jira uses offset, not cursors).

---

## html-exporter.ts — HTML Export Service

**Why it exists:** The generated HTML must be fully self-contained for deployment anywhere (no external CDN dependencies). This service handles image inlining and file output.

### Key exports

| Export | Description |
|--------|-------------|
| `exportRelease(opts)` | Main export function. Returns path + size info |

### Export modes

**Single-file mode:**
```
1. Parse <img src="..."> tags in generated HTML
2. For each src URL:
   ├── Check against private IP blocklist (SSRF prevention)
   ├── fetch(url) with 10s timeout
   ├── Verify Content-Type starts with "image/"
   ├── Enforce 5 MB per-image limit
   └── Replace src with data:{mime};base64,{data}
3. Write single .html file to ~/.shippage/pages/{dir}/
```

**Folder mode:**
```
1. Create directory: ~/.shippage/pages/{sanitized-name}/
2. For each image: download to assets/ subdirectory
3. Rewrite src attributes to relative paths (./assets/image-0.ext)
4. Write index.html
```

### Security

- **SSRF prevention**: Blocklist includes `127.0.0.0/8`, `10.0.0.0/8`, `192.168.0.0/16`, `169.254.0.0/16`, and IPv6 equivalents. DNS resolution is checked after lookup.
- **Path traversal**: `validateExportPath()` from the security module ensures the output path resolves within `~/.shippage/pages/`.
- **Size limit**: Each image is capped at 5 MB. Total HTML is not independently capped but practically bounded by the image limit × count.

---

## template-engine.ts — Handlebars Template Renderer

**Why it exists:** HTML templates use Handlebars for variable substitution and conditional logic. Using the real Handlebars library (not regex) prevents injection through unescaped variables.

### Key exports

| Export | Description |
|--------|-------------|
| `renderTemplate(name, data)` | Load + compile + render a named template |
| `listTemplates()` | Return available template names (built-in + user) |

### Template search order

```
1. ~/.shippage/templates/{name}.html   (user override)
2. {package}/templates/{name}.html     (built-in fallback)
```

This lets users customize templates without modifying the package.

### Custom Handlebars helpers

| Helper | Usage | Description |
|--------|-------|-------------|
| `{{eq a b}}...{{/eq}}` | `{{#eq title "Bug Fixes"}}fixed{{/eq}}` | Block equality check |
| `{{or a b}}` | `{{or description "No description"}}` | First truthy value |
| `{{formatDate date}}` | `{{formatDate date}}` | Formats ISO date as "Month D, YYYY" |

### Security

Handlebars is configured with `{ allowProtoPropertiesByDefault: false }` to prevent prototype pollution attacks through template data.

### Template data shape

```typescript
{
  headline: string;       // Release headline
  intro: string;          // 2-3 sentence summary
  sections: Section[];    // [{title, items: [{title, description, media[]}]}]
  cta: { text, url };     // Call to action
  brandColor: string;     // Hex color (e.g. "#2563EB")
  companyName: string;
  logoUrl: string | null;
  version: string;        // Release version string
  date: string;           // ISO date string
  footer: string | null;
}
```
