import path from "path";
import { SHIPPAGE_DIR } from "../config/store.js";

// ----------------------------------------------------------------
// Input validation utilities — server-side only
// ----------------------------------------------------------------

const PAGES_DIR = path.join(SHIPPAGE_DIR, "pages");
const TEMPLATES_DIR = path.join(SHIPPAGE_DIR, "templates");

/**
 * Validate that a template name is safe (no path traversal).
 * Template names must be alphanumeric + hyphens + underscores only.
 * This prevents: "../../../etc/passwd", "../../config.json", etc.
 */
export function validateTemplateName(name: string): boolean {
  return /^[a-zA-Z0-9_-]{1,64}$/.test(name);
}

/**
 * Validate that an export path stays within ~/.shippage/pages/.
 * Prevents path traversal attacks where a crafted release name could
 * write to arbitrary filesystem locations.
 */
export function validateExportPath(resolvedPath: string): boolean {
  const normalizedPages = path.resolve(PAGES_DIR);
  const normalizedTarget = path.resolve(resolvedPath);
  return normalizedTarget.startsWith(normalizedPages + path.sep);
}

/**
 * Validate that a template path stays within allowed template directories.
 */
export function validateTemplateFilePath(resolvedPath: string): boolean {
  const builtinTemplates = path.resolve(path.join(process.cwd(), "templates"));
  const userTemplates = path.resolve(TEMPLATES_DIR);
  const normalized = path.resolve(resolvedPath);
  return (
    normalized.startsWith(builtinTemplates + path.sep) ||
    normalized.startsWith(userTemplates + path.sep)
  );
}

/**
 * Sanitize a release name for use as a directory name.
 * Allows alphanumeric, hyphens, underscores, dots.
 * Strips everything else. Max 100 chars.
 */
export function sanitizeDirectoryName(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 100)
    .replace(/^-|-$/g, ""); // Trim leading/trailing hyphens
}

/**
 * Validate a URL is HTTP or HTTPS only.
 * Prevents javascript: URLs from being stored as media links.
 */
export function validateHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}
