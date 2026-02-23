# Contributing to ShipPage

Thank you for your interest in contributing!

## Development Setup

```bash
git clone https://github.com/your-org/shippage
cd shippage
pnpm install
pnpm dev
```

`pnpm dev` starts both the Express server (port 4378) and the Vite dev server (port 5173).
The Vite dev server proxies `/api` requests to Express.

## Project Structure

```
src/server/    Express API server (Node.js + TypeScript)
src/client/    React frontend (Vite)
src/shared/    Shared TypeScript types (used by both)
templates/     Built-in HTML page templates (Handlebars)
bin/cli.js     CLI entry point
tests/         Unit and E2E tests
```

## Pull Request Guidelines

1. **One concern per PR** — don't bundle features with bug fixes.
2. **Tests required** for new server-side logic. Use `vitest`.
3. **No breaking config changes** without a migration path. Config schema is versioned.
4. **Security changes** — if your PR touches auth, credentials, or input handling, add a security note in the PR description.
5. **No new cloud dependencies** — ShipPage is intentionally local-only.
6. **No telemetry** — do not add analytics, crash reporting, or any "phone home" behavior.

## Running Tests

```bash
pnpm test          # Unit tests (vitest)
pnpm test:e2e      # E2E tests (playwright)
pnpm typecheck     # TypeScript type check
pnpm lint          # ESLint
```

## Commit Convention

```
feat: add X
fix: correct Y
security: address Z
chore: update dependencies
```

## Security Contributions

See [SECURITY.md](SECURITY.md) for how to report vulnerabilities privately.
