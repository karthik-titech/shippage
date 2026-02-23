// ============================================================
// Shared TypeScript types — used by both server and client.
// DO NOT import server-only or browser-only modules here.
// ============================================================

// ------------------------------------------------------------------
// Integration sources
// ------------------------------------------------------------------
export type IntegrationSource = "linear" | "github" | "jira";

// ------------------------------------------------------------------
// Normalized ticket — all integrations map to this shape.
// Raw API responses are stored separately (rawData) for AI context.
// ------------------------------------------------------------------
export interface NormalizedTicket {
  externalId: string;
  source: IntegrationSource;
  title: string;
  description: string | null;
  labels: string[];
  assignee: string | null;
  status: string;
  url: string;
  completedAt: string | null;
  linkedPRs: string[]; // GitHub PR URLs
  linkedFigma: string[]; // Figma URLs extracted from description/attachments
  linkedLoom: string[]; // Loom video URLs
  rawData: Record<string, unknown>; // Full API response — used for AI context only
}

// ------------------------------------------------------------------
// AI-generated release page structure
// ------------------------------------------------------------------
export interface ReleaseSection {
  title: string;
  items: ReleaseSectionItem[];
}

export interface ReleaseSectionItem {
  title: string;
  description: string;
  ticketId: string; // reference back to NormalizedTicket.externalId
  media: MediaBlock[];
}

export interface MediaBlock {
  type: "image" | "video";
  url: string;
  alt: string;
}

export interface GeneratedReleasePage {
  headline: string;
  intro: string;
  sections: ReleaseSection[];
  cta: {
    text: string;
    url: string;
  };
}

// ------------------------------------------------------------------
// Release — the core domain object stored in SQLite
// ------------------------------------------------------------------
export type ReleaseStatus = "draft" | "published" | "archived";

export interface Release {
  id: string; // UUID
  projectName: string;
  version: string;
  title: string | null;
  description: string | null;
  templateUsed: string;
  sourceIntegration: IntegrationSource;
  generatedContent: GeneratedReleasePage | null; // structured JSON (not HTML)
  generatedHtml: string | null; // final rendered HTML
  outputPath: string | null; // filesystem path to exported page
  status: ReleaseStatus;
  createdAt: string;
  updatedAt: string;
}

export interface TicketSnapshot {
  id: string;
  releaseId: string;
  externalId: string;
  source: IntegrationSource;
  title: string;
  description: string | null;
  labels: string[];
  assignee: string | null;
  status: string;
  url: string;
  createdAt: string;
}

export interface GenerationLogEntry {
  id: string;
  releaseId: string;
  promptHash: string;
  modelUsed: string;
  tokensInput: number;
  tokensOutput: number;
  durationMs: number;
  createdAt: string;
}

// ------------------------------------------------------------------
// Config shape (validated server-side with Zod, typed here)
// ------------------------------------------------------------------
export interface LinearIntegrationConfig {
  defaultTeamId?: string;
  // PAT is stored in OS keychain, NOT in this config object
}

export interface GitHubIntegrationConfig {
  defaultOwner?: string;
  baseUrl?: string; // For GitHub Enterprise — defaults to https://api.github.com
  // PAT is stored in OS keychain
}

export interface JiraIntegrationConfig {
  baseUrl: string; // e.g. https://mycompany.atlassian.net
  email: string;
  apiType: "cloud" | "server"; // Cloud: /rest/api/3/, Server: /rest/api/2/
  // PAT is stored in OS keychain
}

export interface ShipPageConfig {
  version: 1;
  integrations: {
    linear?: LinearIntegrationConfig;
    github?: GitHubIntegrationConfig;
    jira?: JiraIntegrationConfig;
  };
  ai: {
    provider: "anthropic";
    model: string; // default: "claude-sonnet-4-20250514"
    // apiKey is stored in OS keychain
  };
  preferences: {
    defaultTemplate: string;
    companyName?: string;
    brandColor?: string;
    logoPath?: string;
    pageFooter?: string; // undefined = no footer (OFF by default)
  };
}

// What the frontend receives — never contains actual secrets
export interface ConfigStatus {
  integrations: {
    linear: { configured: boolean; defaultTeamId?: string };
    github: { configured: boolean; defaultOwner?: string; baseUrl?: string };
    jira: {
      configured: boolean;
      baseUrl?: string;
      email?: string;
      apiType?: "cloud" | "server";
    };
  };
  ai: {
    configured: boolean;
    model: string;
  };
  preferences: ShipPageConfig["preferences"];
}

// ------------------------------------------------------------------
// API request/response types (used by both client lib and routes)
// ------------------------------------------------------------------
export interface ApiError {
  error: string;
  code?: string;
}

export interface TestConnectionRequest {
  source: IntegrationSource;
}

export interface TestConnectionResponse {
  ok: boolean;
  error?: string; // Never contains the PAT itself
}

export interface FetchTicketsQuery {
  source: IntegrationSource;
  projectId?: string;
  since?: string; // ISO date string
  limit?: number;
}

export interface FetchProjectsQuery {
  source: IntegrationSource;
}

export interface Project {
  id: string;
  name: string;
}

export interface GenerateRequest {
  ticketIds: string[]; // externalIds from NormalizedTicket
  source: IntegrationSource;
  projectId: string;
  version: string; // e.g. "v2.4" — required, not optional
  template: string;
  preferences?: {
    tone?: string;
    customInstructions?: string;
  };
}

export interface GenerateResponse {
  releaseId: string;
  content: GeneratedReleasePage;
  html: string;
  metadata: {
    tokensUsed: number;
    generationTimeMs: number;
    sectionsGenerated: number;
  };
}

export interface UpdateReleaseRequest {
  title?: string;
  version?: string;
  content?: GeneratedReleasePage;
  status?: ReleaseStatus;
}

export interface ExportRequest {
  releaseId: string;
  mode: "single-file" | "folder";
}

export interface ExportResponse {
  path: string;
  filename: string;
  sizeBytes: number;
}
