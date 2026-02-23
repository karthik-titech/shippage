# bin/cli.js — CLI Entry Point

The CLI is the user-facing executable registered as `shippage` in `package.json`'s `bin` field. It runs directly on Node.js (no compilation step) using `#!/usr/bin/env node` with ES module syntax.

## Why this file exists

`bin/cli.js` is the **only** file that users ever interact with from the terminal. It does two things:
1. Validates the environment (Node version, presence of a compiled build) before starting anything
2. Delegates subcommands to the compiled Express server or interactive prompts

Keeping the CLI in plain `.js` avoids requiring users to have TypeScript tooling installed.

## Pre-flight checks

Before any command runs, the CLI performs two mandatory checks:

```
Node.js >= 18?  ──No──► print error + exit(1)
       │
      Yes
       │
dist/server/index.js exists?  ──No──► "Run: pnpm install && pnpm build" + exit(1)
       │
      Yes
       │
  run command
```

This prevents cryptic import errors when the project hasn't been built yet.

## Commands

| Command | What it does |
|---------|-------------|
| `shippage` / `shippage start` | Imports `dist/server/index.js`, calls `createServer()`, starts the server on port 4378 (increments if busy, up to 5 attempts), then opens the browser with `open` |
| `shippage init` | Interactive setup wizard using `inquirer`. Prompts for: Anthropic API key, issue tracker choice (Linear/GitHub/Jira), and tracker-specific credentials. Saves config + stores secrets in keychain |
| `shippage config` | Reads `~/.shippage/config.json`, redacts all secret fields, prints JSON |
| `shippage config set <key> <value>` | Writes a single config key (dot-notation) to `config.json` |
| `shippage list` | Queries SQLite via the server's DB module, prints a table of past releases |
| `shippage export <id>` | Calls the HTML exporter service directly from CLI, saves to current directory |
| `shippage version` | Prints `package.json` version |

## Key dependencies

- **commander** — CLI argument parsing and subcommand dispatch
- **inquirer** — Interactive terminal prompts for `init`
- **open** — Cross-platform browser opener
- **keytar** (optional) — OS keychain integration for secret storage

## Port selection algorithm

```
try port 4378
  ├── EADDRINUSE → try 4379
  ├── EADDRINUSE → try 4380
  │   ... (up to 5 attempts)
  └── still busy → fatal error
```

The chosen port is printed to stdout and used to construct the URL passed to `open`.
