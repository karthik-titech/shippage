import { z } from "zod";

// ----------------------------------------------------------------
// Zod schema for config.json
// NOTE: PATs and API keys are NOT stored here — they live in the
// OS keychain (keytar). This file stores only non-secret config.
// ----------------------------------------------------------------

const LinearConfigSchema = z.object({
  defaultTeamId: z.string().optional(),
});

const GitHubConfigSchema = z.object({
  defaultOwner: z.string().optional(),
  // GitHub Enterprise support — must be HTTPS, not HTTP
  baseUrl: z
    .string()
    .url()
    .regex(/^https:\/\//, "GitHub base URL must use HTTPS")
    .optional(),
});

const JiraConfigSchema = z.object({
  baseUrl: z
    .string()
    .url()
    .regex(/^https:\/\//, "Jira base URL must use HTTPS — Basic auth over HTTP is insecure"),
  email: z.string().email(),
  // IMPORTANT: Cloud uses /rest/api/3/, Server/DC uses /rest/api/2/
  // Auth also differs: Cloud = email+API-token Basic, Server = Bearer PAT
  apiType: z.enum(["cloud", "server"]),
});

const GitLabConfigSchema = z.object({
  baseUrl: z
    .string()
    .url()
    .regex(/^https:\/\//, "GitLab base URL must use HTTPS")
    .optional(),
  defaultGroupId: z.string().optional(),
});

const NotionConfigSchema = z.object({
  defaultDatabaseId: z.string().optional(),
});

const AiConfigSchema = z.object({
  provider: z.literal("anthropic"),
  model: z.string().default("claude-sonnet-4-6"),
});

const PreferencesSchema = z.object({
  defaultTemplate: z.string().default("minimal"),
  companyName: z.string().max(100).optional(),
  brandColor: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, "Brand color must be a valid hex color (e.g. #2563EB)")
    .optional(),
  // logoPath: local filesystem path — validated separately (no traversal)
  logoPath: z.string().optional(),
  // pageFooter: undefined = no footer. Empty string "" also = no footer.
  pageFooter: z.string().max(200).optional(),
});

export const ShipPageConfigSchema = z.object({
  version: z.literal(1),
  integrations: z
    .object({
      linear: LinearConfigSchema.optional(),
      github: GitHubConfigSchema.optional(),
      jira: JiraConfigSchema.optional(),
      gitlab: GitLabConfigSchema.optional(),
      notion: NotionConfigSchema.optional(),
    })
    .default({}),
  ai: AiConfigSchema,
  preferences: PreferencesSchema.default({}),
});

export type ValidatedConfig = z.infer<typeof ShipPageConfigSchema>;

// Default config for first-run
export const DEFAULT_CONFIG: ValidatedConfig = {
  version: 1,
  integrations: {},
  ai: {
    provider: "anthropic",
    model: "claude-sonnet-4-6",
  },
  preferences: {
    defaultTemplate: "minimal",
  },
};
