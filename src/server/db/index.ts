import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { SHIPPAGE_DIR } from "../config/store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(SHIPPAGE_DIR, "shippage.db");
const MIGRATIONS_DIR = path.join(__dirname, "migrations");

// ----------------------------------------------------------------
// IMPORTANT: better-sqlite3 is SYNCHRONOUS.
// All database operations block the event loop.
// For this local CLI tool, this is acceptable and actually desirable
// (simpler code, no async complexity for single-user workload).
// If ShipPage ever becomes multi-user or server-based, migrate to
// a proper async driver (e.g. @libsql/client, drizzle-orm with async).
// ----------------------------------------------------------------

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;

  // Ensure the directory exists before opening
  if (!fs.existsSync(SHIPPAGE_DIR)) {
    throw new Error(
      `ShipPage data directory not found: ${SHIPPAGE_DIR}. Run "shippage init" first.`
    );
  }

  _db = new Database(DB_PATH, {
    // verbose: process.env.DEBUG_SQL ? console.log : undefined,
  });

  // Enable WAL mode and foreign keys for every connection
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");
  // Reasonable busy timeout — prevents "database is locked" errors
  // if two CLI processes somehow run simultaneously
  _db.pragma("busy_timeout = 5000");

  runMigrations(_db);

  return _db;
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

// ----------------------------------------------------------------
// Migration runner
// Migrations are SQL files in migrations/ sorted by filename.
// Each migration runs exactly once (tracked in _migrations table).
// ----------------------------------------------------------------
function runMigrations(db: Database.Database): void {
  // Bootstrap: create _migrations table if it doesn't exist
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT DEFAULT (datetime('now'))
    )
  `);

  const appliedMigrations = new Set(
    db
      .prepare("SELECT name FROM _migrations")
      .all()
      .map((row) => (row as { name: string }).name)
  );

  if (!fs.existsSync(MIGRATIONS_DIR)) {
    throw new Error(`Migrations directory not found: ${MIGRATIONS_DIR}`);
  }

  const migrationFiles = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort(); // Alphabetical = chronological (001_, 002_, etc.)

  for (const file of migrationFiles) {
    if (appliedMigrations.has(file)) continue;

    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf-8");

    // Run each migration in a transaction for atomicity
    const runMigration = db.transaction(() => {
      db.exec(sql);
      db.prepare("INSERT INTO _migrations (name) VALUES (?)").run(file);
    });

    try {
      runMigration();
      console.info(`[ShipPage] Applied migration: ${file}`);
    } catch (err) {
      throw new Error(
        `Failed to apply migration "${file}": ${err instanceof Error ? err.message : String(err)}. ` +
          `Database may be in an inconsistent state. ` +
          `Backup and delete ~/.shippage/shippage.db to reset (you will lose history).`
      );
    }
  }
}
