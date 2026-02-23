# ShipPage

**Turn your changelog into a release marketing page in one click.**

ShipPage is a local CLI tool that pulls tickets from Linear, GitHub Issues, or Jira, uses AI to generate a polished static HTML release page, lets you edit it in a local web UI, and exports self-contained HTML you can deploy anywhere.

**Everything runs on your machine. We store nothing. We host nothing.**

---

## Install & Run

```bash
npx shippage
```

That's it. On first run, ShipPage will guide you through setup.

### Requirements

- Node.js >= 18
- pnpm >= 9 (for development)

---

## What it does

1. **Pulls tickets** from Linear, GitHub Issues, or Jira using your Personal Access Token
2. **You select** which completed tickets belong in this release
3. **AI generates** a polished, structured release page using your Anthropic API key (BYOK)
4. **You edit** the generated page in a local visual editor
5. **Export** a self-contained HTML file — deploy to Vercel, Netlify, GitHub Pages, S3, or anywhere

---

## CLI Commands

```
shippage                          # Start server + open UI (default)
shippage init                     # Re-run first-time setup
shippage config                   # Print current config (secrets redacted)
shippage config set <key> <value> # Set a config value
shippage list                     # List past releases
shippage export <id>              # Export a release to a directory
shippage version                  # Print version
shippage --help                   # Print help
```

---

## Security model

- ShipPage binds **only** to `127.0.0.1` (localhost). It cannot be accessed from other machines.
- Your credentials live in `~/.shippage/config.json` with `0600` permissions (owner read/write only).
- On supported systems (macOS, Linux with libsecret, Windows), credentials are stored in the OS keychain (macOS Keychain, GNOME Keyring, Windows Credential Manager).
- **No telemetry.** No analytics. No "phone home." The only outbound network calls are to the APIs you explicitly configure.
- **No default branding.** The "Powered by ShipPage" footer is OFF by default.

---

## Data storage

All data lives in `~/.shippage/`:

```
~/.shippage/
├── config.json         # Credentials and preferences (0600 permissions)
├── shippage.db         # SQLite: release history, ticket snapshots
├── templates/          # HTML page templates
└── pages/              # Generated output HTML
```

---

## Contributing

See [CONTRIBUTING.md](.github/CONTRIBUTING.md).

## Security vulnerabilities

See [SECURITY.md](.github/SECURITY.md). Please do NOT open public issues for security vulnerabilities.

## License

MIT — see [LICENSE](LICENSE).
