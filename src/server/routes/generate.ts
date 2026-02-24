import { Router } from "express";
import { z } from "zod";
import { readConfig, getSecret } from "../config/store.js";
import { generateReleasePage, estimateInputTokens } from "../services/ai-generator.js";
import { renderTemplate } from "../services/template-engine.js";
import { createRelease, snapshotTickets, logGeneration, updateRelease } from "../db/queries.js";
import { linearClient } from "../services/linear.js";
import { githubClient } from "../services/github.js";
import { jiraClient } from "../services/jira.js";
import { gitlabClient } from "../services/gitlab.js";
import { notionClient } from "../services/notion.js";
import { getPatForSource } from "../config/store.js";
import type { IntegrationSource, NormalizedTicket } from "../../shared/types.js";

export const generateRouter: Router = Router();

// POST /api/generate
const generateSchema = z.object({
  ticketIds: z.array(z.string()).min(1, "Select at least one ticket.").max(100),
  source: z.enum(["linear", "github", "jira", "gitlab", "notion"]),
  projectId: z.string().min(1),
  version: z.string().min(1, "Version is required (e.g. v2.4)").max(50),
  template: z.string().min(1).default("minimal"),
  preferences: z
    .object({
      tone: z.string().max(200).optional(),
      customInstructions: z.string().max(1000).optional(),
    })
    .optional(),
});

generateRouter.post("/", async (req, res) => {
  const parsed = generateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request.", details: parsed.error.flatten() });
    return;
  }

  const { ticketIds, source, projectId, version, template, preferences } = parsed.data;
  const config = readConfig();

  // Check AI API key
  const anthropicKey = await getSecret("anthropicKey");
  if (!anthropicKey) {
    res.status(400).json({
      error: "Anthropic API key not configured. Run `shippage init` to set it up.",
    });
    return;
  }

  // Fetch the tickets from the source
  const pat = await getPatForSource(source as IntegrationSource);
  if (!pat) {
    res.status(400).json({ error: `No ${source} PAT configured.` });
    return;
  }

  let allTickets: NormalizedTicket[];
  try {
    switch (source) {
      case "linear":
        allTickets = await linearClient.fetchCompletedTickets(pat, {
          projectId,
          limit: 200,
        });
        break;
      case "github":
        allTickets = await githubClient.fetchCompletedTickets(pat, {
          projectId,
          baseUrl: config.integrations.github?.baseUrl,
          limit: 200,
        });
        break;
      case "jira": {
        const jiraConfig = config.integrations.jira;
        if (!jiraConfig) {
          res.status(400).json({ error: "Jira not configured." });
          return;
        }
        allTickets = await jiraClient.fetchCompletedTickets(jiraConfig, pat, {
          projectId,
          limit: 200,
        });
        break;
      }
      case "gitlab":
        allTickets = await gitlabClient.fetchCompletedTickets(pat, {
          projectId,
          baseUrl: config.integrations.gitlab?.baseUrl,
          limit: 200,
        });
        break;
      case "notion":
        allTickets = await notionClient.fetchCompletedTickets(pat, {
          projectId,
          limit: 200,
        });
        break;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: `Failed to fetch tickets: ${message}` });
    return;
  }

  // Filter to only the selected ticket IDs
  const selectedTickets = allTickets.filter((t) => ticketIds.includes(t.externalId));

  if (selectedTickets.length === 0) {
    res.status(400).json({
      error: "None of the selected ticket IDs were found. The tickets may have been moved or deleted.",
    });
    return;
  }

  // Estimate token usage and warn if likely to exceed budget
  const estimatedTokens = estimateInputTokens(selectedTickets);
  if (estimatedTokens > 100_000) {
    res.status(400).json({
      error: `Selected tickets would use approximately ${estimatedTokens.toLocaleString()} tokens, which may exceed Claude's context limit. Please select fewer tickets (recommend max 100).`,
    });
    return;
  }

  // Create the release record
  const projectName = projectId.split("/").pop() ?? projectId;
  const release = createRelease({
    projectName,
    version,
    templateUsed: template,
    sourceIntegration: source as IntegrationSource,
  });

  // Snapshot the tickets
  snapshotTickets(release.id, selectedTickets);

  // Generate the AI content
  let generationResult;
  try {
    generationResult = await generateReleasePage({
      tickets: selectedTickets,
      version,
      preferences: {
        companyName: config.preferences.companyName,
        brandColor: config.preferences.brandColor,
        tone: preferences?.tone,
        customInstructions: preferences?.customInstructions,
      },
      model: config.ai.model,
      apiKey: anthropicKey,
    });
  } catch (err) {
    logGeneration(release.id, {
      promptHash: "error",
      modelUsed: config.ai.model,
      tokensInput: 0,
      tokensOutput: 0,
      durationMs: 0,
      success: false,
      errorMessage: err instanceof Error ? err.message : String(err),
    });

    const message = err instanceof Error ? err.message : "AI generation failed.";
    res.status(500).json({ error: message });
    return;
  }

  // Log generation
  logGeneration(release.id, {
    ...generationResult.metadata,
    success: true,
  });

  // Render the HTML
  const html = renderTemplate(template, {
    headline: generationResult.content.headline,
    intro: generationResult.content.intro,
    sections: generationResult.content.sections,
    cta: generationResult.content.cta,
    brandColor: config.preferences.brandColor ?? "#2563EB",
    companyName: config.preferences.companyName ?? "",
    logoUrl: config.preferences.logoPath ?? null,
    version,
    date: new Date().toISOString(),
    footer: config.preferences.pageFooter ?? null,
  });

  // Save to database
  const updatedRelease = updateRelease(release.id, {
    generatedContent: generationResult.content,
    generatedHtml: html,
  });

  res.json({
    releaseId: updatedRelease.id,
    content: generationResult.content,
    html,
    metadata: {
      tokensUsed: generationResult.metadata.tokensInput + generationResult.metadata.tokensOutput,
      generationTimeMs: generationResult.metadata.durationMs,
      sectionsGenerated: generationResult.content.sections.length,
    },
  });
});

// POST /api/generate/:id/rerender
// Re-render the HTML for a release with a different template
// (does NOT call the AI again — uses stored generated_content)
generateRouter.post("/:id/rerender", async (req, res) => {
  const { id } = req.params;
  const { template } = z.object({ template: z.string().min(1) }).parse(req.body);

  const config = readConfig();

  // Get the release
  const { getRelease } = await import("../db/queries.js");
  const release = getRelease(id);

  if (!release) {
    res.status(404).json({ error: "Release not found." });
    return;
  }

  if (!release.generatedContent) {
    res.status(400).json({ error: "Release has no generated content. Generate it first." });
    return;
  }

  const html = renderTemplate(template, {
    headline: release.generatedContent.headline,
    intro: release.generatedContent.intro,
    sections: release.generatedContent.sections,
    cta: release.generatedContent.cta,
    brandColor: config.preferences.brandColor ?? "#2563EB",
    companyName: config.preferences.companyName ?? "",
    logoUrl: config.preferences.logoPath ?? null,
    version: release.version,
    date: release.createdAt,
    footer: config.preferences.pageFooter ?? null,
  });

  const updated = updateRelease(id, { generatedHtml: html, templateUsed: template });

  res.json({ html, release: updated });
});
