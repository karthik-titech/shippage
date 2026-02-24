# tests/ — Test Suite

Two-tier testing strategy: fast unit tests (Vitest, no I/O) and integration smoke tests (Playwright, real server).

---

## Unit tests — tests/unit/

Run with: `pnpm test`

Uses **Vitest** with Node.js environment. No browser, no network calls, no real files. SQLite tests use in-memory databases.

### tests/unit/db/queries.test.ts

Tests the database schema and security utilities.

| Test | What it verifies |
|------|-----------------|
| `creates all tables without error` | Migration `001_initial.sql` runs cleanly on a fresh in-memory DB; all 4 tables exist |
| `enforces foreign key constraints` | `ON DELETE CASCADE` — deleting a release auto-deletes its ticket snapshots |
| `validateExportPath blocks traversal` | Paths outside `~/.shippage/pages/` return `false` |
| `validateTemplateName blocks injection` | Path separators, dots, shell metacharacters, HTML tags all rejected |
| `sanitizeDirectoryName removes dangerous characters` | `../../../evil` → `evil`, `<script>` → `-script-` |

The test uses `SHIPPAGE_DIR_OVERRIDE` env var to redirect file writes to a temp directory so tests never touch `~/.shippage/`.

### tests/unit/services/linear.test.ts

Tests the Linear client with mocked HTTP.

| Test | What it verifies |
|------|-----------------|
| `returns ok:true on successful auth` | A 200 response from the GraphQL viewer query maps to `{ ok: true }` |
| `returns ok:false without exposing PAT on 401` | Error message does not contain the raw PAT string (security test) |
| `extracts Figma URLs from ticket descriptions` | A ticket with a Figma URL in its description gets a populated `linkedFigma[]` array |

Uses `vi.fn()` to mock `global.fetch`. Each test resets mocks with `vi.resetAllMocks()`.

---

## E2E tests — tests/e2e/

Run with: `pnpm test:e2e`

Uses **Playwright** against a real Express server started by `tests/e2e/test-server.ts` on port 3999.

### tests/e2e/test-server.ts

```typescript
// Starts the real server in devMode (no frontend serving) on port 3999
const { start } = await createServer({ devMode: true });
await start(3999);
```

`devMode: true` skips the static file serving so tests don't need a Vite build.

### tests/e2e/smoke.spec.ts

| Test | What it verifies |
|------|-----------------|
| `GET /api/csrf-token returns a token` | Endpoint is reachable, returns `{ token: string }` |
| `CSRF token is stable within a session` | Two requests in the same session return identical tokens |
| `GET /api/config with CSRF token` | Config endpoint returns version, ai.model; no secrets in response |
| `GET /api/releases (fresh install)` | Returns `{ releases: [], count: 0 }` (not 500 or empty response) |
| `POST without CSRF token → 403` | Missing CSRF header is rejected before hitting any business logic |
| `DELETE without CSRF token → 403` | Same check for DELETE method |
| `server responds to 127.0.0.1` | Localhost middleware allows the test runner's requests |

---

## playwright.config.ts

```typescript
webServer: {
  command: "tsx tests/e2e/test-server.ts",   // starts real Express on :3999
  url: "http://127.0.0.1:3999/api/csrf-token", // wait until this responds 200
  reuseExistingServer: !process.env.CI,        // reuse in dev, fresh in CI
  timeout: 15_000,
}
```

Tests use Playwright's `request` fixture (no browser UI) for fast, headless API-level testing. UI tests (browser navigation) are not yet written.

---

## CI integration (.github/workflows/ci.yml)

Runs on GitHub-hosted Ubuntu runners (free on public repos). See [CONTRIBUTING.md](../CONTRIBUTING.md) for self-hosted runner setup if you're working on a private fork.

```
Push / PR to main:
  ├── Job: lint-type-test (matrix: Node 18, 20, 22)
  │   ├── pnpm lint         (ESLint flat config)
  │   ├── pnpm typecheck    (tsc --noEmit, both tsconfig.server and tsconfig.client)
  │   ├── pnpm test         (Vitest unit tests)
  │   └── pnpm build        (compile server + bundle client)
  │
  ├── Job: e2e (Node 20, needs: lint-type-test)
  │   ├── pnpm test:e2e     (Playwright API smoke tests against real Express on :3999)
  │   └── pnpm test:e2e:ui  (Playwright browser navigation tests against built app)
  │
  └── Job: security (Node 22)
      ├── npm audit --audit-level=high   (blocks on high/critical vulns)
      └── Snyk scan (if SNYK_TOKEN secret configured)
```

Linux runners require `libsecret-1-dev` for keytar (native OS keychain bindings). The workflow installs it before `pnpm install` in jobs that need it.
