import { Router } from "express";
import { z } from "zod";
import { readConfig, writeConfig, setSecret, getSecretStatus } from "../config/store.js";
import { ShipPageConfigSchema } from "../config/schema.js";

export const configRouter: Router = Router();

// GET /api/config
// Returns config with all secrets redacted
configRouter.get("/", async (_req, res) => {
  try {
    const config = readConfig();
    const secretStatus = await getSecretStatus();

    res.json({
      config: {
        version: config.version,
        integrations: {
          linear: config.integrations.linear
            ? { ...config.integrations.linear, configured: secretStatus.linear }
            : { configured: false },
          github: config.integrations.github
            ? { ...config.integrations.github, configured: secretStatus.github }
            : { configured: false },
          jira: config.integrations.jira
            ? { ...config.integrations.jira, configured: secretStatus.jira }
            : { configured: false },
          gitlab: config.integrations.gitlab
            ? { ...config.integrations.gitlab, configured: secretStatus.gitlab }
            : { configured: false },
          notion: config.integrations.notion
            ? { ...config.integrations.notion, configured: secretStatus.notion }
            : { configured: false },
        },
        ai: {
          provider: config.ai.provider,
          model: config.ai.model,
          configured: secretStatus.anthropic,
        },
        preferences: config.preferences,
      },
    });
  } catch {
    res.status(500).json({ error: "Failed to read configuration." });
  }
});

// POST /api/config/secrets
// Save a secret to the OS keychain (or config fallback)
// NEVER log or echo back the secret value
const secretsSchema = z.object({
  key: z.enum(["linearPat", "githubPat", "jiraPat", "gitlabPat", "notionToken", "anthropicKey"]),
  value: z.string().min(1, "Secret value cannot be empty."),
});

configRouter.post("/secrets", async (req, res) => {
  const parsed = secretsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request.", details: parsed.error.flatten() });
    return;
  }

  try {
    await setSecret(parsed.data.key, parsed.data.value);
    // Confirm storage without echoing the value back
    res.json({ ok: true, key: parsed.data.key });
  } catch {
    res.status(500).json({ error: "Failed to save secret." });
  }
});

// PATCH /api/config
// Update non-secret configuration
const updateConfigSchema = z.object({
  ai: z
    .object({
      model: z.string().optional(),
    })
    .optional(),
  integrations: z
    .object({
      linear: z
        .object({ defaultTeamId: z.string().optional() })
        .optional(),
      github: z
        .object({
          defaultOwner: z.string().optional(),
          baseUrl: z.string().url().optional(),
        })
        .optional(),
      jira: z
        .object({
          baseUrl: z.string().url(),
          email: z.string().email(),
          apiType: z.enum(["cloud", "server"]),
        })
        .optional(),
      gitlab: z
        .object({
          baseUrl: z.string().url().optional(),
          defaultGroupId: z.string().optional(),
        })
        .optional(),
      notion: z
        .object({
          defaultDatabaseId: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
  preferences: z
    .object({
      defaultTemplate: z.string().optional(),
      companyName: z.string().max(100).optional(),
      brandColor: z
        .string()
        .regex(/^#[0-9A-Fa-f]{6}$/)
        .optional(),
      logoPath: z.string().optional(),
      pageFooter: z.string().max(200).optional(),
    })
    .optional(),
});

configRouter.patch("/", (req, res) => {
  const parsed = updateConfigSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request.", details: parsed.error.flatten() });
    return;
  }

  try {
    const current = readConfig();

    // Deep merge the updates
    const updated = ShipPageConfigSchema.parse({
      ...current,
      ai: { ...current.ai, ...parsed.data.ai },
      integrations: {
        ...current.integrations,
        ...(parsed.data.integrations?.linear
          ? { linear: { ...current.integrations.linear, ...parsed.data.integrations.linear } }
          : {}),
        ...(parsed.data.integrations?.github
          ? { github: { ...current.integrations.github, ...parsed.data.integrations.github } }
          : {}),
        ...(parsed.data.integrations?.jira
          ? { jira: { ...current.integrations.jira, ...parsed.data.integrations.jira } }
          : {}),
        ...(parsed.data.integrations?.gitlab
          ? { gitlab: { ...current.integrations.gitlab, ...parsed.data.integrations.gitlab } }
          : {}),
        ...(parsed.data.integrations?.notion
          ? { notion: { ...current.integrations.notion, ...parsed.data.integrations.notion } }
          : {}),
      },
      preferences: { ...current.preferences, ...parsed.data.preferences },
    });

    writeConfig(updated);
    res.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to update config.";
    res.status(500).json({ error: message });
  }
});
