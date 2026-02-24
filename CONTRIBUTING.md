# Contributing to ShipPage

Thanks for your interest in contributing. ShipPage is a local CLI tool — no cloud account, no infra to manage. The contribution loop is fast.

---

## Prerequisites

- Node.js ≥ 18
- pnpm 9 (`npm install -g pnpm`)
- An Anthropic API key (for running generate tests end-to-end, optional)

---

## Getting started

```bash
git clone https://github.com/karthik-titech/shippage
cd shippage
pnpm install
pnpm dev        # starts Express (tsx watch) + Vite dev server concurrently
```

The Express server starts on port 4378, Vite on port 5173. Open http://localhost:5173 to see the UI in dev mode.

---

## Running the test suite locally

```bash
pnpm lint        # ESLint (must pass before pushing)
pnpm typecheck   # tsc --noEmit for server + client
pnpm test        # Vitest unit tests (85 tests, ~2s)
pnpm test:e2e    # Playwright API smoke tests (real Express, port 3999)
pnpm build       # compile server + bundle client
```

All five commands must pass for CI to go green.

---

## CI pipeline

CI runs on **GitHub-hosted Ubuntu runners** (free for public repos). The workflow is at `.github/workflows/ci.yml`.

```
Push / PR to main
  ├── lint-type-test  (matrix: Node 18, 20, 22)
  │   ├── pnpm lint
  │   ├── pnpm typecheck
  │   ├── pnpm test
  │   └── pnpm build
  │
  ├── e2e  (Node 20, needs: lint-type-test)
  │   ├── pnpm test:e2e   (API smoke tests)
  │   └── pnpm test:e2e:ui (browser navigation)
  │
  └── security  (Node 22)
      ├── npm audit --audit-level=high
      └── Snyk scan (if SNYK_TOKEN secret is set)
```

> **Note on private forks:** GitHub Actions on private repos requires either the free-tier minute allowance or a spending limit above $0. The simplest workaround is a self-hosted runner (see below) or making your fork public.

---

## Running CI on a private fork with a self-hosted runner

If you want CI to run on a private fork without any GitHub billing, you can register your own machine as a runner. This takes about 5 minutes.

### 1 — Create a registration token

```bash
# Requires the gh CLI and repo admin access
gh api -X POST repos/YOUR_USERNAME/shippage/actions/runners/registration-token --jq '.token'
```

### 2 — Download and configure the runner

Pick the archive that matches your machine:

| OS | Architecture | Download |
|----|-------------|---------|
| macOS | Apple Silicon (M1/M2/M3) | `actions-runner-osx-arm64-2.323.0.tar.gz` |
| macOS | Intel | `actions-runner-osx-x64-2.323.0.tar.gz` |
| Linux | x64 | `actions-runner-linux-x64-2.323.0.tar.gz` |
| Linux | arm64 | `actions-runner-linux-arm64-2.323.0.tar.gz` |
| Windows | x64 | `actions-runner-win-x64-2.323.0.zip` |

All releases: https://github.com/actions/runner/releases/tag/v2.323.0

```bash
mkdir -p ~/actions-runner && cd ~/actions-runner

# Example: macOS Apple Silicon
curl -o runner.tar.gz -L \
  https://github.com/actions/runner/releases/download/v2.323.0/actions-runner-osx-arm64-2.323.0.tar.gz
tar xzf runner.tar.gz

./config.sh \
  --url https://github.com/YOUR_USERNAME/shippage \
  --token THE_TOKEN_FROM_STEP_1 \
  --name "my-runner" \
  --labels "self-hosted" \
  --unattended
```

### 3 — Start the runner

**Run once (foreground):**
```bash
./run.sh
```

**Install as a persistent service (recommended):**

macOS / Linux:
```bash
./svc.sh install
./svc.sh start
./svc.sh status   # should show "active (running)"
```

Windows (run as Administrator):
```powershell
./svc.sh install
./svc.sh start
```

### 4 — Update the workflow to target your runner

Change all three `runs-on:` lines in `.github/workflows/ci.yml` from `ubuntu-latest` to `self-hosted`:

```yaml
runs-on: self-hosted
```

> **Do not commit this change** if you intend to open a PR back to the main repo — PRs should target `ubuntu-latest` so CI works for everyone.

### 5 — Verify

Go to **github.com → your-fork/shippage → Settings → Actions → Runners**. Your runner should appear as **Idle**. Push a commit to trigger a run.

### Removing the runner

```bash
cd ~/actions-runner
./svc.sh stop
./svc.sh uninstall
./config.sh remove --token THE_TOKEN_FROM_STEP_1
```

---

## Project structure

```
bin/           CLI entry point (plain .js, no compilation)
src/
  server/      Express API, services, config, DB
  client/      React + Vite frontend
  shared/      Types shared between server and client
templates/     Handlebars HTML templates (minimal, changelog, feature-launch)
tests/
  unit/        Vitest tests (no I/O)
  e2e/         Playwright tests (real Express server)
```

Each subdirectory has its own `README.md` with implementation details.

---

## Code conventions

- TypeScript strict mode throughout
- ESLint flat config (`eslint.config.js`) — zero warnings on lint means zero errors in CI
- No `any` — use `unknown` and narrow at call sites
- Express route handlers: async is fine, `no-misused-promises` is suppressed for routes
- Secrets: never log, never send to frontend, never hardcode
- New integrations: follow the pattern in `src/server/services/gitlab.ts` (auth, test, fetchProjects, fetchCompletedTickets, pagination, error classes)

---

## Opening a pull request

1. Fork the repo and create a branch from `main`
2. Run `pnpm lint && pnpm typecheck && pnpm test && pnpm build` — all must pass
3. Open a PR with a description of what changed and why
4. CI will run automatically on the PR