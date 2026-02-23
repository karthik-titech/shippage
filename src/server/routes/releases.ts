import { Router } from "express";
import { z } from "zod";
import {
  listReleases,
  getRelease,
  updateRelease,
  deleteRelease,
  getTicketsForRelease,
  getGenerationHistory,
} from "../db/queries.js";
import type { GeneratedReleasePage, ReleaseStatus } from "../../shared/types.js";

export const releasesRouter = Router();

// GET /api/releases
releasesRouter.get("/", (req, res) => {
  const query = z
    .object({
      project: z.string().optional(),
      status: z.enum(["draft", "published", "archived"]).optional(),
      limit: z.coerce.number().int().min(1).max(100).default(20),
    })
    .safeParse(req.query);

  if (!query.success) {
    res.status(400).json({ error: "Invalid query parameters." });
    return;
  }

  const releases = listReleases({
    projectName: query.data.project,
    status: query.data.status as ReleaseStatus | undefined,
    limit: query.data.limit,
  });

  res.json({ releases, count: releases.length });
});

// GET /api/releases/:id
releasesRouter.get("/:id", (req, res) => {
  const release = getRelease(req.params.id);
  if (!release) {
    res.status(404).json({ error: "Release not found." });
    return;
  }
  res.json({ release });
});

// GET /api/releases/:id/tickets
releasesRouter.get("/:id/tickets", (req, res) => {
  const release = getRelease(req.params.id);
  if (!release) {
    res.status(404).json({ error: "Release not found." });
    return;
  }
  const tickets = getTicketsForRelease(req.params.id);
  res.json({ tickets });
});

// GET /api/releases/:id/history
releasesRouter.get("/:id/history", (req, res) => {
  const release = getRelease(req.params.id);
  if (!release) {
    res.status(404).json({ error: "Release not found." });
    return;
  }
  const history = getGenerationHistory(req.params.id);
  res.json({ history });
});

// PATCH /api/releases/:id
// Update release content, title, version, or status
const updateSchema = z.object({
  title: z.string().max(200).optional(),
  version: z.string().max(50).optional(),
  content: z.unknown().optional(), // Validated as GeneratedReleasePage below
  status: z.enum(["draft", "published", "archived"]).optional(),
});

releasesRouter.patch("/:id", async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body.", details: parsed.error.flatten() });
    return;
  }

  const release = getRelease(req.params.id);
  if (!release) {
    res.status(404).json({ error: "Release not found." });
    return;
  }

  // If content is being updated, re-render the HTML with the stored template
  let generatedHtml: string | undefined;
  let generatedContent: GeneratedReleasePage | undefined;

  if (parsed.data.content) {
    generatedContent = parsed.data.content as GeneratedReleasePage;

    // Re-render with the stored template
    const { renderTemplate } = await import("../services/template-engine.js");
    const { readConfig } = await import("../config/store.js");
    const config = readConfig();

    generatedHtml = renderTemplate(release.templateUsed, {
      headline: generatedContent.headline,
      intro: generatedContent.intro,
      sections: generatedContent.sections,
      cta: generatedContent.cta,
      brandColor: config.preferences.brandColor ?? "#2563EB",
      companyName: config.preferences.companyName ?? "",
      logoUrl: config.preferences.logoPath ?? null,
      version: parsed.data.version ?? release.version,
      date: release.createdAt,
      footer: config.preferences.pageFooter ?? null,
    });
  }

  const updated = updateRelease(req.params.id, {
    title: parsed.data.title,
    version: parsed.data.version,
    generatedContent,
    generatedHtml,
    status: parsed.data.status as ReleaseStatus | undefined,
  });

  res.json({ release: updated });
});

// DELETE /api/releases/:id
releasesRouter.delete("/:id", (req, res) => {
  const release = getRelease(req.params.id);
  if (!release) {
    res.status(404).json({ error: "Release not found." });
    return;
  }
  deleteRelease(req.params.id);
  res.status(204).end();
});
