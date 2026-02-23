import { v4 as uuidv4 } from "uuid";
import sanitizeHtml from "sanitize-html";
import { getDb } from "./index.js";
import type {
  Release,
  TicketSnapshot,
  GenerationLogEntry,
  NormalizedTicket,
  GeneratedReleasePage,
  ReleaseStatus,
  IntegrationSource,
} from "../../shared/types.js";

// ----------------------------------------------------------------
// Row types — raw SQLite rows before transformation
// ----------------------------------------------------------------
interface ReleaseRow {
  id: string;
  project_name: string;
  version: string;
  title: string | null;
  description: string | null;
  template_used: string;
  source_integration: string;
  generated_content: string | null;
  generated_html: string | null;
  output_path: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

interface TicketSnapshotRow {
  id: string;
  release_id: string;
  external_id: string;
  source: string;
  title: string;
  description: string | null;
  labels: string;
  assignee: string | null;
  status: string | null;
  url: string | null;
  raw_data: string | null;
  created_at: string;
}

interface GenerationHistoryRow {
  id: string;
  release_id: string;
  prompt_hash: string;
  model_used: string;
  tokens_input: number;
  tokens_output: number;
  duration_ms: number;
  success: number;
  error_message: string | null;
  created_at: string;
}

// ----------------------------------------------------------------
// Type transformers (snake_case DB → camelCase TypeScript)
// ----------------------------------------------------------------
function rowToRelease(row: ReleaseRow): Release {
  return {
    id: row.id,
    projectName: row.project_name,
    version: row.version,
    title: row.title,
    description: row.description,
    templateUsed: row.template_used,
    sourceIntegration: row.source_integration as IntegrationSource,
    generatedContent: row.generated_content
      ? (JSON.parse(row.generated_content) as GeneratedReleasePage)
      : null,
    generatedHtml: row.generated_html,
    outputPath: row.output_path,
    status: row.status as ReleaseStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToTicketSnapshot(row: TicketSnapshotRow): TicketSnapshot {
  return {
    id: row.id,
    releaseId: row.release_id,
    externalId: row.external_id,
    source: row.source as IntegrationSource,
    title: row.title,
    description: row.description,
    labels: JSON.parse(row.labels) as string[],
    assignee: row.assignee,
    status: row.status ?? "",
    url: row.url ?? "",
    createdAt: row.created_at,
  };
}

// ----------------------------------------------------------------
// Release queries
// ----------------------------------------------------------------
export function createRelease(data: {
  projectName: string;
  version: string;
  templateUsed: string;
  sourceIntegration: IntegrationSource;
  title?: string;
}): Release {
  const db = getDb();
  const id = uuidv4();
  db.prepare(`
    INSERT INTO releases (id, project_name, version, title, template_used, source_integration)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, data.projectName, data.version, data.title ?? null, data.templateUsed, data.sourceIntegration);

  const row = db.prepare("SELECT * FROM releases WHERE id = ?").get(id) as ReleaseRow;
  return rowToRelease(row);
}

export function getRelease(id: string): Release | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM releases WHERE id = ?").get(id) as ReleaseRow | undefined;
  return row ? rowToRelease(row) : null;
}

export function listReleases(filters?: {
  projectName?: string;
  status?: ReleaseStatus;
  limit?: number;
}): Release[] {
  const db = getDb();
  let sql = "SELECT * FROM releases WHERE 1=1";
  const params: unknown[] = [];

  if (filters?.projectName) {
    sql += " AND project_name = ?";
    params.push(filters.projectName);
  }
  if (filters?.status) {
    sql += " AND status = ?";
    params.push(filters.status);
  }

  sql += " ORDER BY created_at DESC";

  if (filters?.limit) {
    sql += " LIMIT ?";
    params.push(filters.limit);
  }

  const rows = db.prepare(sql).all(...params) as ReleaseRow[];
  return rows.map(rowToRelease);
}

export function updateRelease(
  id: string,
  data: {
    title?: string;
    version?: string;
    templateUsed?: string;
    generatedContent?: GeneratedReleasePage;
    generatedHtml?: string;
    outputPath?: string;
    status?: ReleaseStatus;
  }
): Release {
  const db = getDb();
  const fields: string[] = ["updated_at = datetime('now')"];
  const params: unknown[] = [];

  if (data.title !== undefined) { fields.push("title = ?"); params.push(data.title); }
  if (data.version !== undefined) { fields.push("version = ?"); params.push(data.version); }
  if (data.templateUsed !== undefined) { fields.push("template_used = ?"); params.push(data.templateUsed); }
  if (data.generatedContent !== undefined) {
    fields.push("generated_content = ?");
    params.push(JSON.stringify(data.generatedContent));
  }
  if (data.generatedHtml !== undefined) { fields.push("generated_html = ?"); params.push(data.generatedHtml); }
  if (data.outputPath !== undefined) { fields.push("output_path = ?"); params.push(data.outputPath); }
  if (data.status !== undefined) { fields.push("status = ?"); params.push(data.status); }

  if (fields.length === 1) {
    // Only updated_at — no-op but valid
    db.prepare(`UPDATE releases SET ${fields.join(", ")} WHERE id = ?`).run(id);
  } else {
    params.push(id);
    db.prepare(`UPDATE releases SET ${fields.join(", ")} WHERE id = ?`).run(...params);
  }

  const row = db.prepare("SELECT * FROM releases WHERE id = ?").get(id) as ReleaseRow | undefined;
  if (!row) throw new Error(`Release not found: ${id}`);
  return rowToRelease(row);
}

export function deleteRelease(id: string): void {
  const db = getDb();
  // Cascades to ticket_snapshots and generation_history via FK
  db.prepare("DELETE FROM releases WHERE id = ?").run(id);
}

// ----------------------------------------------------------------
// Ticket snapshot queries
// ----------------------------------------------------------------
export function snapshotTickets(releaseId: string, tickets: NormalizedTicket[]): void {
  const db = getDb();
  const insert = db.prepare(`
    INSERT OR IGNORE INTO ticket_snapshots
      (id, release_id, external_id, source, title, description, labels, assignee, status, url, raw_data)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // Sanitize ticket HTML before storage.
  // Ticket titles/descriptions come from external APIs (user-controlled).
  // Strip all HTML tags — we only want plain text in the DB.
  // This prevents stored XSS if description content is ever rendered
  // outside of a React JSX context (e.g. in a template or email).
  const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
    allowedTags: [],        // strip ALL HTML tags
    allowedAttributes: {},  // strip all attributes
    disallowedTagsMode: "discard",
  };

  const insertMany = db.transaction((ticketList: NormalizedTicket[]) => {
    for (const ticket of ticketList) {
      insert.run(
        uuidv4(),
        releaseId,
        ticket.externalId,
        ticket.source,
        sanitizeHtml(ticket.title, SANITIZE_OPTIONS),
        ticket.description ? sanitizeHtml(ticket.description, SANITIZE_OPTIONS) : null,
        JSON.stringify(ticket.labels.map((l) => sanitizeHtml(l, SANITIZE_OPTIONS))),
        ticket.assignee,
        ticket.status,
        ticket.url,
        // NOTE: raw_data can be large. We only store it for AI re-generation purposes.
        JSON.stringify(ticket.rawData)
      );
    }
  });

  insertMany(tickets);
}

export function getTicketsForRelease(releaseId: string): TicketSnapshot[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM ticket_snapshots WHERE release_id = ? ORDER BY created_at ASC")
    .all(releaseId) as TicketSnapshotRow[];
  return rows.map(rowToTicketSnapshot);
}

// ----------------------------------------------------------------
// Generation history queries
// ----------------------------------------------------------------
export function logGeneration(
  releaseId: string,
  data: {
    promptHash: string;
    modelUsed: string;
    tokensInput: number;
    tokensOutput: number;
    durationMs: number;
    success: boolean;
    errorMessage?: string;
  }
): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO generation_history
      (id, release_id, prompt_hash, model_used, tokens_input, tokens_output, duration_ms, success, error_message)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    uuidv4(),
    releaseId,
    data.promptHash,
    data.modelUsed,
    data.tokensInput,
    data.tokensOutput,
    data.durationMs,
    data.success ? 1 : 0,
    data.errorMessage ?? null
  );
}

export function getGenerationHistory(releaseId: string): GenerationLogEntry[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM generation_history WHERE release_id = ? ORDER BY created_at DESC")
    .all(releaseId) as GenerationHistoryRow[];
  return rows.map((row) => ({
    id: row.id,
    releaseId: row.release_id,
    promptHash: row.prompt_hash,
    modelUsed: row.model_used,
    tokensInput: row.tokens_input,
    tokensOutput: row.tokens_output,
    durationMs: row.duration_ms,
    createdAt: row.created_at,
  }));
}
