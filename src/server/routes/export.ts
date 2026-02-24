import { Router } from "express";
import { z } from "zod";
import { getRelease } from "../db/queries.js";
import { exportRelease } from "../services/html-exporter.js";
import { listAvailableTemplates } from "../services/template-engine.js";
import { notionClient } from "../services/notion.js";
import { getSecret } from "../config/store.js";

export const exportRouter: Router = Router();

// POST /api/export
const exportSchema = z.object({
  releaseId: z.string().uuid("Invalid release ID format."),
  mode: z.enum(["single-file", "folder"]).default("single-file"),
});

exportRouter.post("/", async (req, res) => {
  const parsed = exportSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request.", details: parsed.error.flatten() });
    return;
  }

  const release = getRelease(parsed.data.releaseId);
  if (!release) {
    res.status(404).json({ error: "Release not found." });
    return;
  }

  if (!release.generatedHtml) {
    res.status(400).json({ error: "Release has no generated HTML. Generate it first." });
    return;
  }

  try {
    const result = await exportRelease(release, parsed.data.mode);
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Export failed.";
    res.status(500).json({ error: message });
  }
});

// GET /api/export/notion/pages
// Returns pages accessible to the Notion integration (for parent page picker)
exportRouter.get("/notion/pages", async (_req, res) => {
  const notionToken = await getSecret("notionToken");
  if (!notionToken) {
    res.status(400).json({ error: "Notion not configured. Run `shippage init` to set it up." });
    return;
  }

  try {
    const pages = await notionClient.fetchParentPages(notionToken);
    res.json({ pages });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch Notion pages.";
    res.status(500).json({ error: message });
  }
});

// POST /api/export/notion
// Publish a release page to Notion under a parent page
const notionPublishSchema = z.object({
  releaseId: z.string().uuid("Invalid release ID format."),
  parentPageId: z.string().min(1, "parentPageId is required."),
});

exportRouter.post("/notion", async (req, res) => {
  const parsed = notionPublishSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request.", details: parsed.error.flatten() });
    return;
  }

  const { releaseId, parentPageId } = parsed.data;

  const release = getRelease(releaseId);
  if (!release) {
    res.status(404).json({ error: "Release not found." });
    return;
  }

  if (!release.generatedContent) {
    res.status(400).json({ error: "Release has no generated content. Generate it first." });
    return;
  }

  const notionToken = await getSecret("notionToken");
  if (!notionToken) {
    res.status(400).json({ error: "Notion not configured. Run `shippage init` to set it up." });
    return;
  }

  try {
    const result = await notionClient.publishReleasePage(notionToken, parentPageId, {
      ...release.generatedContent,
      version: release.version,
      title: release.title ?? undefined,
    });
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to publish to Notion.";
    res.status(500).json({ error: message });
  }
});

// GET /api/export/templates
exportRouter.get("/templates", (_req, res) => {
  const templates = listAvailableTemplates();
  res.json({ templates });
});

// GET /api/export/:releaseId/html
// Returns the raw HTML for a release (for clipboard copy or preview)
exportRouter.get("/:releaseId/html", (req, res) => {
  const { releaseId } = req.params;
  const release = getRelease(releaseId);

  if (!release) {
    res.status(404).json({ error: "Release not found." });
    return;
  }

  if (!release.generatedHtml) {
    res.status(404).json({ error: "No HTML generated yet." });
    return;
  }

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(release.generatedHtml);
});
