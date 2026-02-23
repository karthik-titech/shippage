import fs from "fs";
import path from "path";
import { SHIPPAGE_DIR } from "../config/store.js";
import { sanitizeDirectoryName, validateExportPath, validateHttpUrl } from "../security/validate.js";
import { updateRelease } from "../db/queries.js";
import type { Release } from "../../shared/types.js";

const PAGES_DIR = path.join(SHIPPAGE_DIR, "pages");
const MAX_SINGLE_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB limit for single-file mode

export interface ExportResult {
  path: string;
  filename: string;
  sizeBytes: number;
}

// ----------------------------------------------------------------
// SSRF Protection: Validate URLs before fetching
// Prevents the exporter from being used to probe internal network
// addresses (e.g., AWS metadata endpoint 169.254.169.254).
// ----------------------------------------------------------------
const BLOCKED_IP_PATTERNS = [
  /^127\./,           // Loopback
  /^10\./,            // Private Class A
  /^172\.(1[6-9]|2\d|3[01])\./,  // Private Class B
  /^192\.168\./,      // Private Class C
  /^169\.254\./,      // Link-local (AWS metadata, etc.)
  /^::1$/,            // IPv6 loopback
  /^fc00:/,           // IPv6 unique local
  /^fe80:/,           // IPv6 link-local
];

function isBlockedUrl(url: string): boolean {
  if (!validateHttpUrl(url)) return true;
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname;
    return BLOCKED_IP_PATTERNS.some((pattern) => pattern.test(hostname));
  } catch {
    return true;
  }
}

// ----------------------------------------------------------------
// Inline an image URL as a base64 data URI
// Only used in single-file mode
// ----------------------------------------------------------------
async function inlineImageUrl(url: string): Promise<string | null> {
  if (isBlockedUrl(url)) {
    console.warn(`[ShipPage] Skipped inlining blocked URL: ${url}`);
    return null;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) return null;

    // Check content type and size
    const contentType = response.headers.get("content-type") ?? "image/png";
    if (!contentType.startsWith("image/")) return null;

    const buffer = await response.arrayBuffer();
    const sizeKb = buffer.byteLength / 1024;

    if (sizeKb > 500) {
      // Skip large images in single-file mode — they'll bloat the HTML
      console.warn(`[ShipPage] Skipped inlining large image (${Math.round(sizeKb)}KB): ${url}`);
      return null;
    }

    const base64 = Buffer.from(buffer).toString("base64");
    return `data:${contentType};base64,${base64}`;
  } catch {
    return null;
  }
}

// ----------------------------------------------------------------
// Single-file export
// ----------------------------------------------------------------
async function exportSingleFile(
  html: string,
  outputDir: string,
  inlineImages: boolean
): Promise<ExportResult> {
  let finalHtml = html;

  if (inlineImages) {
    // Find all src="https://..." attributes and inline them
    const imgRegex = /src="(https?:\/\/[^"]+)"/g;
    const urls = [...html.matchAll(imgRegex)].map((m) => m[1]).filter(Boolean);

    for (const url of urls) {
      const dataUri = await inlineImageUrl(url as string);
      if (dataUri) {
        finalHtml = finalHtml.replace(`src="${url}"`, `src="${dataUri}"`);
      }
    }
  }

  const sizeBytes = Buffer.byteLength(finalHtml, "utf-8");
  if (sizeBytes > MAX_SINGLE_FILE_SIZE_BYTES) {
    console.warn(
      `[ShipPage] Single-file export is ${Math.round(sizeBytes / 1024)}KB ` +
        `(limit: ${Math.round(MAX_SINGLE_FILE_SIZE_BYTES / 1024)}KB). ` +
        `Consider using folder mode for releases with many images.`
    );
  }

  const outputPath = path.join(outputDir, "index.html");

  if (!validateExportPath(outputPath)) {
    throw new Error("Export path validation failed — possible path traversal attempt.");
  }

  fs.writeFileSync(outputPath, finalHtml, "utf-8");
  return { path: outputPath, filename: "index.html", sizeBytes };
}

// ----------------------------------------------------------------
// Folder export (index.html + assets/)
// ----------------------------------------------------------------
async function exportFolder(
  html: string,
  outputDir: string
): Promise<ExportResult> {
  const assetsDir = path.join(outputDir, "assets");

  if (!validateExportPath(assetsDir)) {
    throw new Error("Export path validation failed.");
  }

  fs.mkdirSync(assetsDir, { recursive: true });

  // Download external images into assets/
  const imgRegex = /src="(https?:\/\/[^"]+)"/g;
  let finalHtml = html;
  let assetCounter = 0;

  for (const match of [...html.matchAll(imgRegex)]) {
    const url = match[1];
    if (!url || isBlockedUrl(url)) continue;

    try {
      const ext = new URL(url).pathname.split(".").pop() ?? "png";
      const filename = `image-${++assetCounter}.${ext}`;
      const assetPath = path.join(assetsDir, filename);

      if (!validateExportPath(assetPath)) continue;

      const response = await fetch(url);
      if (!response.ok) continue;

      const buffer = await response.arrayBuffer();
      fs.writeFileSync(assetPath, Buffer.from(buffer));
      finalHtml = finalHtml.replace(`src="${url}"`, `src="assets/${filename}"`);
    } catch {
      // Skip failed downloads — leave original URL
    }
  }

  const outputPath = path.join(outputDir, "index.html");
  fs.writeFileSync(outputPath, finalHtml, "utf-8");

  const sizeBytes = Buffer.byteLength(finalHtml, "utf-8");
  return { path: outputPath, filename: "index.html", sizeBytes };
}

// ----------------------------------------------------------------
// Main export function
// ----------------------------------------------------------------
export async function exportRelease(
  release: Release,
  mode: "single-file" | "folder"
): Promise<ExportResult> {
  if (!release.generatedHtml) {
    throw new Error("Release has no generated HTML. Generate it first.");
  }

  // Build output directory name from project name + version
  const dirName = sanitizeDirectoryName(`${release.projectName}-${release.version}`);
  const outputDir = path.join(PAGES_DIR, dirName);

  if (!validateExportPath(outputDir)) {
    throw new Error("Export directory validation failed.");
  }

  // Create output directory
  fs.mkdirSync(outputDir, { mode: 0o700, recursive: true });

  let result: ExportResult;

  if (mode === "single-file") {
    result = await exportSingleFile(release.generatedHtml, outputDir, true);
  } else {
    result = await exportFolder(release.generatedHtml, outputDir);
  }

  // Update the release record with the output path
  updateRelease(release.id, { outputPath: result.path, status: "published" });

  return result;
}
