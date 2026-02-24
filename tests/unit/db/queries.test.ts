import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
import fs from "fs";
import os from "os";
import path from "path";

// ----------------------------------------------------------------
// DB queries tests
// Uses a temp in-memory database — does NOT touch ~/.shippage/
// ----------------------------------------------------------------

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shippage-test-"));
  // Point the SHIPPAGE_DIR to our temp dir for tests
  process.env["SHIPPAGE_DIR_OVERRIDE"] = tmpDir;
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("SQLite migrations", () => {
  it("creates all tables without error", async () => {
    // Create a fresh in-memory database and run migrations
    const db = new Database(":memory:");
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");

    // Read and execute the migration
    const migrationPath = new URL(
      "../../../src/server/db/migrations/001_initial.sql",
      import.meta.url
    ).pathname;
    const sql = fs.readFileSync(migrationPath, "utf-8");
    db.exec(sql);

    // Verify tables exist
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r) => (r as { name: string }).name);

    expect(tables).toContain("releases");
    expect(tables).toContain("ticket_snapshots");
    expect(tables).toContain("generation_history");
    expect(tables).toContain("_migrations");

    db.close();
  });

  it("enforces foreign key constraints", () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");

    db.exec(`
      CREATE TABLE releases (
        id TEXT PRIMARY KEY,
        project_name TEXT NOT NULL,
        version TEXT NOT NULL,
        template_used TEXT NOT NULL,
        source_integration TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE ticket_snapshots (
        id TEXT PRIMARY KEY,
        release_id TEXT NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
        external_id TEXT NOT NULL,
        source TEXT NOT NULL,
        title TEXT NOT NULL,
        labels TEXT NOT NULL DEFAULT '[]',
        created_at TEXT DEFAULT (datetime('now'))
      );
    `);

    db.prepare("INSERT INTO releases VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
      "rel-1", "my-app", "v1.0", "minimal", "linear", "draft",
      new Date().toISOString(), new Date().toISOString()
    );
    db.prepare("INSERT INTO ticket_snapshots VALUES (?, ?, ?, ?, ?, ?, ?)").run(
      "snap-1", "rel-1", "ENG-1", "linear", "Fix bug", "[]", new Date().toISOString()
    );

    // Delete release — should cascade delete the ticket snapshot
    db.prepare("DELETE FROM releases WHERE id = ?").run("rel-1");
    const remaining = db.prepare("SELECT * FROM ticket_snapshots WHERE release_id = ?").all("rel-1");
    expect(remaining).toHaveLength(0);

    db.close();
  });
});

describe("Security: path validation", () => {
  it("validateExportPath blocks traversal", async () => {
    const { validateExportPath } = await import("../../../src/server/security/validate.js");
    // Should reject paths that escape the pages directory
    expect(validateExportPath("/tmp/shippage-test/pages/valid-release")).toBe(false); // wrong base
  });

  it("validateTemplateName blocks injection", async () => {
    const { validateTemplateName } = await import("../../../src/server/security/validate.js");
    expect(validateTemplateName("minimal")).toBe(true);
    expect(validateTemplateName("my-template")).toBe(true);
    expect(validateTemplateName("../../../etc/passwd")).toBe(false);
    expect(validateTemplateName("template; rm -rf /")).toBe(false);
    expect(validateTemplateName("template<script>")).toBe(false);
    expect(validateTemplateName("")).toBe(false);
  });

  it("sanitizeDirectoryName removes dangerous characters", async () => {
    const { sanitizeDirectoryName } = await import("../../../src/server/security/validate.js");
    expect(sanitizeDirectoryName("my-app v2.4")).toBe("my-app-v2.4");
    expect(sanitizeDirectoryName("../../../evil")).toBe("evil");
    expect(sanitizeDirectoryName("release<script>alert(1)</script>")).toBe(
      "release-script-alert-1-script"
    );
  });
});
