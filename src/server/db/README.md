# src/server/db/ — Database Layer

ShipPage uses **SQLite** via `better-sqlite3` (synchronous API). One database file at `~/.shippage/shippage.db`.

## Why SQLite?

- **No setup**: works out of the box, no daemon to start
- **Single-user**: no concurrency issues
- **Portable**: the entire release history is one file the user can copy or back up
- **Synchronous API**: simpler code, no async/await for DB calls

---

## migrations/001_initial.sql — Schema

### Tables

#### `releases`

The top-level record for each generated release page.

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PRIMARY KEY | UUIDv4 |
| `project_name` | TEXT | Human name of the project |
| `version` | TEXT | Version string (e.g. "v2.4.0") |
| `title` | TEXT | Optional override title |
| `template_used` | TEXT | Template name ("minimal", "changelog", etc.) |
| `source_integration` | TEXT | "linear", "github", or "jira" |
| `status` | TEXT | "draft", "published", or "archived" |
| `generated_content` | TEXT | JSON blob of `GeneratedReleasePage` |
| `generated_html` | TEXT | Rendered HTML string |
| `created_at` | TEXT | ISO 8601 datetime |
| `updated_at` | TEXT | ISO 8601 datetime |

#### `ticket_snapshots`

Point-in-time copies of tickets at generation time. Tickets change in the source system after generation; we snapshot so we can re-generate with the same data.

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PRIMARY KEY | UUIDv4 |
| `release_id` | TEXT REFERENCES releases(id) ON DELETE CASCADE | Parent release |
| `external_id` | TEXT | Original ID in the source system (e.g. "ENG-42") |
| `source` | TEXT | "linear", "github", or "jira" |
| `title` | TEXT | **Sanitized** plain-text title |
| `description` | TEXT | **Sanitized** plain-text description |
| `labels` | TEXT | JSON array of label strings |
| `assignee` | TEXT | Assignee display name |
| `status` | TEXT | Status at snapshot time |
| `url` | TEXT | URL to the issue in the source system |
| `raw_data` | TEXT | Full JSON from source API (for AI re-generation context) |

#### `generation_history`

Audit log of every AI generation attempt for a release.

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PRIMARY KEY | UUIDv4 |
| `release_id` | TEXT REFERENCES releases(id) ON DELETE CASCADE | Parent release |
| `model_used` | TEXT | e.g. "claude-sonnet-4-6" |
| `tokens_input` | INTEGER | Prompt token count |
| `tokens_output` | INTEGER | Completion token count |
| `duration_ms` | INTEGER | Wall-clock time |
| `prompt_hash` | TEXT | SHA-256 of the prompt (for debugging, not re-use) |
| `created_at` | TEXT | ISO 8601 datetime |

#### `_migrations`

Internal migration tracking. One row per applied migration file.

| Column | Type |
|--------|------|
| `name` | TEXT PRIMARY KEY |
| `applied_at` | TEXT |

### Constraints

- `foreign_keys = ON` — enforced at connection time
- `ON DELETE CASCADE` — deleting a release auto-deletes its ticket snapshots and generation history
- `journal_mode = WAL` — better concurrent read performance (even though we're single-writer)

---

## queries.ts — Data Access Functions

All database access goes through this file. No SQL appears in route handlers.

### Migration runner

```typescript
getDb() → opens connection → runs pending migrations → returns db instance
```

Migrations are discovered by reading `.sql` files from `migrations/`, sorted alphabetically, and applied only if not already recorded in `_migrations`.

### Key functions

| Function | Description |
|----------|-------------|
| `listReleases(opts)` | Paginated list, filterable by project name and status |
| `createRelease(data)` | Insert + return new release row |
| `getRelease(id)` | Single release by ID |
| `updateRelease(id, data)` | Partial update; always updates `updated_at` |
| `deleteRelease(id)` | Hard delete (cascades to snapshots + history) |
| `snapshotTickets(releaseId, tickets)` | Bulk-insert ticket snapshots with sanitization |
| `getTicketsForRelease(id)` | All snapshots for a release |
| `recordGeneration(data)` | Append to generation_history |
| `getGenerationHistory(id)` | Audit log for a release |

### Sanitization in snapshotTickets

```typescript
// Applied to every ticket before insertion:
const SANITIZE_OPTIONS = {
  allowedTags: [],        // strip ALL HTML tags
  allowedAttributes: {},  // strip all attributes
  disallowedTagsMode: "discard",
};

title       = sanitizeHtml(ticket.title, SANITIZE_OPTIONS);
description = sanitizeHtml(ticket.description, SANITIZE_OPTIONS);
labels      = ticket.labels.map(l => sanitizeHtml(l, SANITIZE_OPTIONS));
// rawData is NOT sanitized — it's only used in the AI prompt, never rendered
```

This prevents stored XSS if description content is ever rendered outside of a JSX context (e.g. in a custom template or future email feature).
