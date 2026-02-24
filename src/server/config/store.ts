import fs from "fs";
import path from "path";
import os from "os";
import type { IntegrationSource } from "../../shared/types.js";
import { ShipPageConfigSchema, DEFAULT_CONFIG } from "./schema.js";
import type { ValidatedConfig } from "./schema.js";

// ----------------------------------------------------------------
// Keytar: optional dependency for OS keychain storage.
// If not available (missing build tools, CI, etc.), falls back to
// a plaintext warning. We NEVER silently fall back without warning.
// ----------------------------------------------------------------
let keytar: typeof import("keytar") | null = null;
try {
  keytar = (await import("keytar")) as typeof import("keytar");
} catch {
  // keytar failed to load — native bindings not available
  // This is expected in some CI environments and on machines without build tools
}

const KEYTAR_SERVICE = "shippage";
const KEYTAR_ACCOUNTS = {
  linearPat: "linear-pat",
  githubPat: "github-pat",
  jiraPat: "jira-pat",
  gitlabPat: "gitlab-pat",
  notionToken: "notion-token",
  anthropicKey: "anthropic-api-key",
} as const;

export const SHIPPAGE_DIR = path.join(os.homedir(), ".shippage");
const CONFIG_PATH = path.join(SHIPPAGE_DIR, "config.json");
const TEMPLATES_DIR = path.join(SHIPPAGE_DIR, "templates");
const PAGES_DIR = path.join(SHIPPAGE_DIR, "pages");

// ----------------------------------------------------------------
// Directory bootstrap — called on first run
// ----------------------------------------------------------------
export function ensureShipPageDirs(): void {
  // 0700: owner rwx, no group/other access
  if (!fs.existsSync(SHIPPAGE_DIR)) {
    fs.mkdirSync(SHIPPAGE_DIR, { mode: 0o700, recursive: true });
  }
  if (!fs.existsSync(TEMPLATES_DIR)) {
    fs.mkdirSync(TEMPLATES_DIR, { mode: 0o700, recursive: true });
  }
  if (!fs.existsSync(PAGES_DIR)) {
    fs.mkdirSync(PAGES_DIR, { mode: 0o700, recursive: true });
  }
}

// ----------------------------------------------------------------
// Config read/write
// ----------------------------------------------------------------
export function readConfig(): ValidatedConfig {
  if (!fs.existsSync(CONFIG_PATH)) {
    return DEFAULT_CONFIG;
  }

  const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      `Config file at ${CONFIG_PATH} is not valid JSON. ` +
        `You may need to run "shippage init" to reset it.`
    );
  }

  const result = ShipPageConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `Config file at ${CONFIG_PATH} has invalid structure: ${result.error.message}. ` +
        `Run "shippage init" to reconfigure.`
    );
  }

  return result.data;
}

export function writeConfig(config: ValidatedConfig): void {
  ensureShipPageDirs();
  const validated = ShipPageConfigSchema.parse(config);
  const json = JSON.stringify(validated, null, 2);
  // Write atomically: write to temp file, then rename
  const tmpPath = CONFIG_PATH + ".tmp";
  fs.writeFileSync(tmpPath, json, { mode: 0o600 });
  fs.renameSync(tmpPath, CONFIG_PATH);
  // Ensure permissions are correct even if file already existed
  fs.chmodSync(CONFIG_PATH, 0o600);
}

// ----------------------------------------------------------------
// Secret management via OS keychain
// Falls back to plaintext in config (with loud warning) if keytar
// is unavailable — this handles CI and build-tool-less environments.
// ----------------------------------------------------------------
export async function getSecret(account: keyof typeof KEYTAR_ACCOUNTS): Promise<string | null> {
  const accountName = KEYTAR_ACCOUNTS[account];

  if (keytar) {
    return keytar.getPassword(KEYTAR_SERVICE, accountName);
  }

  // Fallback: read from config file (insecure — warn loudly)
  console.warn(
    `[ShipPage] WARNING: OS keychain (keytar) is unavailable. ` +
      `Reading secret for "${accountName}" from config file. ` +
      `This is less secure. Install build tools and reinstall to enable keychain storage.`
  );
  const config = readConfig();
  return ((config as Record<string, unknown>)[`_plaintext_${accountName}`] ?? null) as string | null;
}

export async function setSecret(
  account: keyof typeof KEYTAR_ACCOUNTS,
  value: string
): Promise<void> {
  const accountName = KEYTAR_ACCOUNTS[account];

  if (keytar) {
    await keytar.setPassword(KEYTAR_SERVICE, accountName, value);
    return;
  }

  // Fallback: store in config file with loud warning
  console.warn(
    `[ShipPage] WARNING: OS keychain (keytar) is unavailable. ` +
      `Storing secret for "${accountName}" in config file (~/.shippage/config.json). ` +
      `Ensure this file is not committed to version control.`
  );
  const config = readConfig();
  (config as Record<string, unknown>)[`_plaintext_${accountName}`] = value;
  writeConfig(config);
}

export async function deleteSecret(account: keyof typeof KEYTAR_ACCOUNTS): Promise<void> {
  const accountName = KEYTAR_ACCOUNTS[account];
  if (keytar) {
    await keytar.deletePassword(KEYTAR_SERVICE, accountName);
  }
}

// ----------------------------------------------------------------
// Convenience: get all secrets at once (for use in service clients)
// ----------------------------------------------------------------
export interface LoadedSecrets {
  linearPat: string | null;
  githubPat: string | null;
  jiraPat: string | null;
  gitlabPat: string | null;
  notionToken: string | null;
  anthropicKey: string | null;
}

export async function loadSecrets(): Promise<LoadedSecrets> {
  const [linearPat, githubPat, jiraPat, gitlabPat, notionToken, anthropicKey] = await Promise.all([
    getSecret("linearPat"),
    getSecret("githubPat"),
    getSecret("jiraPat"),
    getSecret("gitlabPat"),
    getSecret("notionToken"),
    getSecret("anthropicKey"),
  ]);
  return { linearPat, githubPat, jiraPat, gitlabPat, notionToken, anthropicKey };
}

// ----------------------------------------------------------------
// Redacted config — safe to log or send to frontend
// ----------------------------------------------------------------
export interface RedactedSecretStatus {
  linear: boolean;
  github: boolean;
  jira: boolean;
  gitlab: boolean;
  notion: boolean;
  anthropic: boolean;
}

export async function getSecretStatus(): Promise<RedactedSecretStatus> {
  const secrets = await loadSecrets();
  return {
    linear: secrets.linearPat !== null && secrets.linearPat !== "",
    github: secrets.githubPat !== null && secrets.githubPat !== "",
    jira: secrets.jiraPat !== null && secrets.jiraPat !== "",
    gitlab: secrets.gitlabPat !== null && secrets.gitlabPat !== "",
    notion: secrets.notionToken !== null && secrets.notionToken !== "",
    anthropic: secrets.anthropicKey !== null && secrets.anthropicKey !== "",
  };
}

// ----------------------------------------------------------------
// Integration-specific PAT helper
// ----------------------------------------------------------------
export async function getPatForSource(source: IntegrationSource): Promise<string | null> {
  switch (source) {
    case "linear":
      return getSecret("linearPat");
    case "github":
      return getSecret("githubPat");
    case "jira":
      return getSecret("jiraPat");
    case "gitlab":
      return getSecret("gitlabPat");
    case "notion":
      return getSecret("notionToken");
  }
}
