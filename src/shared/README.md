# src/shared/ — Shared TypeScript Types

Types in this directory are imported by both the server and the client. They define the data contracts that flow through the system.

## types.ts

### Core interfaces

#### `NormalizedTicket`

The common shape that all three integrations (Linear, GitHub, Jira) normalize their tickets into. The AI generator and the DB layer work exclusively with this type.

```typescript
interface NormalizedTicket {
  externalId: string;      // "ENG-42", "github-1234", "PROJ-7"
  source: "linear" | "github" | "jira";
  title: string;           // Plain text (sanitized)
  description: string | null; // Plain text (sanitized)
  labels: string[];
  assignee: string | null; // Display name
  status: string;          // Status name at time of fetch
  url: string;             // Deep link to the issue
  linkedFigma: string[];   // Extracted Figma URLs from description/attachments
  linkedLoom: string[];    // Extracted Loom URLs from description/attachments
  rawData: unknown;        // Full API response (for AI context, not rendered)
}
```

#### `GeneratedReleasePage`

The JSON output from Claude. This is stored in the `generated_content` DB column and is the source of truth for the Editor UI.

```typescript
interface GeneratedReleasePage {
  headline: string;
  intro: string;
  sections: Array<{
    title: string;
    items: Array<{
      title: string;
      description: string;
      ticketId: string;   // Reference back to the NormalizedTicket.externalId
      media: Array<{
        type: "image" | "video";
        url: string;       // Image URL or "#" placeholder
        alt: string;
      }>;
    }>;
  }>;
  cta: {
    text: string;
    url: string;
  };
}
```

#### `ShipPageConfig`

The shape of `~/.shippage/config.json`. Validated at read time by `ShipPageConfigSchema` (Zod).

```typescript
interface ShipPageConfig {
  version: 1;
  integrations: {
    linear?: { defaultTeamId?: string };
    github?: { defaultOwner?: string; baseUrl?: string };
    jira?: { baseUrl: string; email: string; apiType: "cloud" | "server" };
  };
  ai: {
    provider: "anthropic";
    model: string;         // default: "claude-sonnet-4-6"
  };
  preferences: {
    defaultTemplate: string;  // default: "minimal"
    companyName?: string;
    brandColor?: string;      // validated: /^#[0-9A-Fa-f]{6}$/
    logoPath?: string;
    pageFooter?: string;
  };
}
```

#### `Release`

The database release record as returned to the frontend (after DB column-to-camelCase mapping).

```typescript
interface Release {
  id: string;
  projectName: string;
  version: string;
  title: string | null;
  templateUsed: string;
  sourceIntegration: "linear" | "github" | "jira";
  status: "draft" | "published" | "archived";
  generatedContent: GeneratedReleasePage | null;
  generatedHtml: string | null;
  createdAt: string;
  updatedAt: string;
}
```

## Why a shared directory?

The `@shared` path alias (configured in both `tsconfig.json` paths and `vite.config.ts` resolve.alias) allows both the server and client to import from the same source:

```typescript
// Server (src/server/services/ai-generator.ts):
import type { NormalizedTicket, GeneratedReleasePage } from "../../shared/types.js";

// Client (src/client/pages/Editor.tsx):
import type { GeneratedReleasePage } from "@shared/types";
```

This prevents type drift between what the server sends and what the client expects.
