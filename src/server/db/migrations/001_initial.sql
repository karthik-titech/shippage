-- Migration 001: Initial schema
-- Run once on database creation.

-- Enable WAL mode for better concurrent read performance and crash safety.
-- WAL is safe for single-writer (which is all we need), and survives crashes.
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- Track applied migrations
CREATE TABLE IF NOT EXISTS _migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  applied_at TEXT DEFAULT (datetime('now'))
);

-- Core releases table
CREATE TABLE IF NOT EXISTS releases (
  id TEXT PRIMARY KEY,                    -- UUID v4
  project_name TEXT NOT NULL,
  version TEXT NOT NULL,
  title TEXT,
  description TEXT,
  template_used TEXT NOT NULL,
  source_integration TEXT NOT NULL CHECK(source_integration IN ('linear', 'github', 'jira')),
  -- generated_content: JSON of GeneratedReleasePage structure (structured, editable)
  -- Kept separate from generated_html so users can re-render with different templates
  generated_content TEXT,                 -- JSON
  generated_html TEXT,                    -- Final rendered HTML
  output_path TEXT,                       -- Filesystem path to exported page
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'published', 'archived')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Ticket snapshots: immutable record of what was in each release at generation time.
-- NOTE: raw_data column stores full API JSON. This can grow large for releases with
-- many tickets (e.g. 50 tickets × 5KB each = 250KB per release). Monitor DB size.
CREATE TABLE IF NOT EXISTS ticket_snapshots (
  id TEXT PRIMARY KEY,                    -- UUID v4
  release_id TEXT NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,              -- Linear/GitHub/Jira ticket ID
  source TEXT NOT NULL CHECK(source IN ('linear', 'github', 'jira')),
  title TEXT NOT NULL,
  description TEXT,
  labels TEXT NOT NULL DEFAULT '[]',      -- JSON array of strings
  assignee TEXT,
  status TEXT,
  url TEXT,
  raw_data TEXT,                          -- Full JSON from source API (for AI context)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(release_id, external_id, source) -- Prevent duplicate tickets per release
);

-- Generation log: tracks AI API usage (tokens, cost estimation, timing).
-- Prompt hash allows detecting duplicate generations (e.g. retry detection).
CREATE TABLE IF NOT EXISTS generation_history (
  id TEXT PRIMARY KEY,                    -- UUID v4
  release_id TEXT NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
  prompt_hash TEXT NOT NULL,              -- SHA256 of prompt (NOT the prompt itself)
  model_used TEXT NOT NULL,
  tokens_input INTEGER NOT NULL DEFAULT 0,
  tokens_output INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  success INTEGER NOT NULL DEFAULT 1 CHECK(success IN (0, 1)),  -- 0=failed, 1=success
  error_message TEXT,                     -- Only set if success=0
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_releases_project ON releases(project_name);
CREATE INDEX IF NOT EXISTS idx_releases_status ON releases(status);
CREATE INDEX IF NOT EXISTS idx_releases_created ON releases(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ticket_snapshots_release ON ticket_snapshots(release_id);
CREATE INDEX IF NOT EXISTS idx_generation_history_release ON generation_history(release_id);
