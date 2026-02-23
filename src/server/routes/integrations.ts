import { Router } from "express";
import { z } from "zod";
import { readConfig, getPatForSource, getSecretStatus } from "../config/store.js";
import { linearClient } from "../services/linear.js";
import { githubClient } from "../services/github.js";
import { jiraClient } from "../services/jira.js";
import type { IntegrationSource, NormalizedTicket } from "../../shared/types.js";

export const integrationsRouter = Router();

// GET /api/integrations/status
// Returns which integrations are configured (no secrets)
integrationsRouter.get("/status", async (_req, res) => {
  try {
    const config = readConfig();
    const secretStatus = await getSecretStatus();

    res.json({
      integrations: {
        linear: {
          configured: secretStatus.linear,
          defaultTeamId: config.integrations.linear?.defaultTeamId,
        },
        github: {
          configured: secretStatus.github,
          defaultOwner: config.integrations.github?.defaultOwner,
          baseUrl: config.integrations.github?.baseUrl,
        },
        jira: {
          configured: secretStatus.jira,
          baseUrl: config.integrations.jira?.baseUrl,
          email: config.integrations.jira?.email,
          apiType: config.integrations.jira?.apiType,
        },
      },
      ai: {
        configured: secretStatus.anthropic,
        model: config.ai.model,
      },
      preferences: config.preferences,
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to read configuration." });
  }
});

// POST /api/integrations/test
// Test a specific integration's connection
const testConnectionSchema = z.object({
  source: z.enum(["linear", "github", "jira"]),
});

integrationsRouter.post("/test", async (req, res) => {
  const parsed = testConnectionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request.", details: parsed.error.flatten() });
    return;
  }

  const { source } = parsed.data;
  const pat = await getPatForSource(source as IntegrationSource);

  if (!pat) {
    res.status(400).json({ ok: false, error: `No ${source} PAT configured.` });
    return;
  }

  try {
    const config = readConfig();

    switch (source) {
      case "linear": {
        const result = await linearClient.testConnection(pat);
        res.json(result);
        break;
      }
      case "github": {
        const result = await githubClient.testConnection(
          pat,
          config.integrations.github?.baseUrl
        );
        res.json(result);
        break;
      }
      case "jira": {
        const jiraConfig = config.integrations.jira;
        if (!jiraConfig) {
          res.status(400).json({ ok: false, error: "Jira not configured." });
          return;
        }
        const result = await jiraClient.testConnection(jiraConfig, pat);
        res.json(result);
        break;
      }
    }
  } catch {
    // Don't expose internal error details — they could contain the PAT in some edge cases
    res.status(500).json({ ok: false, error: "Connection test failed. Check server logs." });
  }
});

// GET /api/integrations/projects?source=linear
const projectsQuerySchema = z.object({
  source: z.enum(["linear", "github", "jira"]),
});

integrationsRouter.get("/projects", async (req, res) => {
  const parsed = projectsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "source parameter required (linear|github|jira)" });
    return;
  }

  const { source } = parsed.data;
  const pat = await getPatForSource(source as IntegrationSource);

  if (!pat) {
    res.status(400).json({ error: `No ${source} PAT configured.` });
    return;
  }

  try {
    const config = readConfig();
    let projects: Array<{ id: string; name: string }>;

    switch (source) {
      case "linear":
        projects = await linearClient.fetchProjects(pat);
        break;
      case "github":
        projects = await githubClient.fetchProjects(
          pat,
          config.integrations.github?.baseUrl,
          config.integrations.github?.defaultOwner
        );
        break;
      case "jira": {
        const jiraConfig = config.integrations.jira;
        if (!jiraConfig) {
          res.status(400).json({ error: "Jira not configured." });
          return;
        }
        projects = await jiraClient.fetchProjects(jiraConfig, pat);
        break;
      }
    }

    res.json({ projects });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    // Safe to return this error message — we verified it doesn't include PATs in the client code
    res.status(500).json({ error: message });
  }
});

// GET /api/integrations/tickets?source=linear&projectId=TEAM-ID&since=2024-01-01&limit=50
const ticketsQuerySchema = z.object({
  source: z.enum(["linear", "github", "jira"]),
  projectId: z.string().optional(),
  since: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

integrationsRouter.get("/tickets", async (req, res) => {
  const parsed = ticketsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query parameters.", details: parsed.error.flatten() });
    return;
  }

  const { source, projectId, since, limit } = parsed.data;
  const pat = await getPatForSource(source as IntegrationSource);

  if (!pat) {
    res.status(400).json({ error: `No ${source} PAT configured.` });
    return;
  }

  try {
    const config = readConfig();
    const sinceDate = since ? new Date(since) : undefined;
    let tickets: NormalizedTicket[];

    switch (source) {
      case "linear":
        tickets = await linearClient.fetchCompletedTickets(pat, {
          projectId,
          since: sinceDate,
          limit,
        });
        break;
      case "github": {
        if (!projectId) {
          res.status(400).json({ error: "projectId (owner/repo) is required for GitHub." });
          return;
        }
        tickets = await githubClient.fetchCompletedTickets(pat, {
          projectId,
          since: sinceDate,
          limit,
          baseUrl: config.integrations.github?.baseUrl,
        });
        break;
      }
      case "jira": {
        const jiraConfig = config.integrations.jira;
        if (!jiraConfig) {
          res.status(400).json({ error: "Jira not configured." });
          return;
        }
        tickets = await jiraClient.fetchCompletedTickets(jiraConfig, pat, {
          projectId,
          since: sinceDate,
          limit,
        });
        break;
      }
    }

    res.json({ tickets, count: tickets.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});
