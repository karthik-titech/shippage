# ShipPage

**Turn your changelog into a release marketing page in one click.**

ShipPage is a local CLI tool that pulls tickets from Linear, GitHub Issues, or Jira, uses Claude AI to generate a polished static HTML release page, lets you edit it in a local web UI, and exports a self-contained HTML file you can deploy anywhere.

**Everything runs on your machine. Nothing is stored in the cloud. Nothing is hosted.**

---

## Quick Start

```bash
npx shippage
```

On first run ShipPage walks you through connecting your issue tracker and Anthropic API key. After that, one command generates your release page.

**Requirements:** Node.js ≥ 18

---

## How It Works

```
Issue tracker (Linear / GitHub / Jira)
        │
        ▼  PAT auth
┌──────────────────┐
│  ShipPage CLI    │  starts on localhost:4378
│  (Express API)   │◄────── React UI (browser)
└──────────────────┘
        │
        ▼  Anthropic API (BYOK)
┌──────────────────┐       ┌─────────────────────┐
│  Claude AI       │──────►│  Release Page (HTML) │
│  (claude-sonnet) │       │  Self-contained file │
└──────────────────┘       └─────────────────────┘
```

1. **Connect** — provide a PAT for Linear, GitHub, or Jira (stored in OS keychain)
2. **Select tickets** — pick the completed issues that belong in this release
3. **Generate** — Claude writes a structured, user-facing release page
4. **Edit** — tweak the content in the local form editor; preview updates live
5. **Export** — download a self-contained HTML file, deploy anywhere

---

## CLI Reference

```
shippage                          Start server and open UI (default)
shippage init                     Re-run first-time setup wizard
shippage config                   Print current config (secrets redacted)
shippage config set <key> <val>   Set a single config value
shippage list                     List past releases
shippage export <id>              Export a release to a local directory
shippage version                  Print version
shippage --help                   Print help
```

---

## File Structure

```
shippage/
├── bin/
│   └── cli.js                    CLI entry point (Node.js ESM, no build needed)
├── src/
│   ├── server/                   Express API server (compiled to dist/server/)
│   │   ├── config/               Zod config schema + file-system config store
│   │   ├── db/                   SQLite via better-sqlite3; queries + migrations
│   │   ├── routes/               REST API route handlers
│   │   ├── security/             CSRF, localhost-only, path validation
│   │   └── services/             Business logic: AI, integrations, export, templates
│   ├── client/                   React 18 SPA (compiled to dist/client/ by Vite)
│   │   ├── pages/                Route-level page components
│   │   ├── components/           Shared UI components
│   │   ├── lib/                  API client (fetch wrapper with CSRF)
│   │   └── styles/               Tailwind globals
│   └── shared/
│       └── types.ts              TypeScript interfaces shared between server and client
├── templates/                    Handlebars HTML release page templates
│   ├── minimal.html              Clean, editorial layout
│   ├── changelog.html            Sidebar + categorized changelog layout
│   └── feature-launch.html      Hero + cards marketing layout
├── tests/
│   ├── unit/                     Vitest unit tests (no network, in-memory DB)
│   └── e2e/                      Playwright integration tests (real server)
├── .github/
│   ├── workflows/ci.yml          CI: lint → typecheck → test → build → security audit
│   ├── CONTRIBUTING.md           Contribution guide
│   └── SECURITY.md               Vulnerability disclosure policy
├── playwright.config.ts          Playwright e2e configuration
├── vite.config.ts                Vite frontend build + dev proxy config
├── tsconfig.json                 Base TypeScript config (strict mode)
├── tsconfig.server.json          Server: NodeNext module resolution → dist/server/
└── tsconfig.client.json          Client: bundler resolution, DOM libs → dist/client/
```

---

## Data Storage

All local data lives in `~/.shippage/`:

```
~/.shippage/
├── config.json         Preferences and non-secret config (chmod 0600)
├── shippage.db         SQLite: releases, ticket snapshots, generation history
├── templates/          User-supplied custom templates (override built-ins)
└── pages/              Exported HTML output files
```

PATs and the Anthropic API key are stored in the **OS keychain** (macOS Keychain, GNOME Keyring, Windows Credential Manager) via `keytar`. On systems without keychain support, they fall back to the config file with a warning.

---

## Security Model

| Threat | Mitigation |
|--------|-----------|
| External network access | Server binds to `127.0.0.1` only; `localhostOnly` middleware rejects all other IPs |
| Cross-site request forgery | CSRF token injected into HTML; required on every mutation |
| Credential theft | PATs stored in OS keychain; never logged; never returned to frontend |
| Prompt injection | Ticket data wrapped in `<ticket_data>` XML; Claude instructed to treat as data |
| Stored XSS | `sanitize-html` strips all HTML from ticket fields before SQLite storage |
| Path traversal | `validateExportPath()` checks all export paths against allowed directories |
| SSRF | Private IP ranges blocked before fetching any external image |
| Supply chain | `npm audit --audit-level=high` blocks CI on high/critical vulns; Snyk optional |

---

## Development

```bash
pnpm install
pnpm dev          # Starts Express (tsx watch) + Vite dev server concurrently
pnpm test         # Vitest unit tests
pnpm test:e2e     # Playwright integration tests
pnpm typecheck    # tsc --noEmit (both server and client)
pnpm lint         # ESLint
pnpm build        # Compile server (tsc) + bundle client (vite build)
```

For detailed docs on each subsystem see the `README.md` files inside each directory under `src/`.

---

## Contributing

See [CONTRIBUTING.md](.github/CONTRIBUTING.md).

## Security Vulnerabilities

See [SECURITY.md](.github/SECURITY.md). Do **not** open public issues for vulnerabilities.

## License

MIT — see [LICENSE](LICENSE).
