# Security Policy

## Reporting a Vulnerability

**Do NOT open a public GitHub issue for security vulnerabilities.**

Report vulnerabilities by emailing: security@shippage.dev

Please include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Any suggested mitigations

We aim to respond within 48 hours and will credit reporters in release notes (unless anonymity is requested).

## Security Model

ShipPage is a **local-only tool**. It runs entirely on your machine.

### What ShipPage does:
- Binds ONLY to `127.0.0.1` (localhost). Cannot be accessed from other machines or on a network.
- Stores credentials in the OS keychain (macOS Keychain, Linux Secret Service, Windows Credential Manager) when available.
- Falls back to `~/.shippage/config.json` with `0600` permissions if keychain is unavailable.
- CSRF tokens protect the local API from same-machine cross-origin requests.
- Never transmits your data to any server except the APIs you explicitly configure (Linear, GitHub, Jira, Anthropic).
- **Never phones home**, tracks usage, or sends telemetry of any kind.

### What ShipPage does NOT do:
- Does not run a cloud server.
- Does not store your data anywhere except your local machine.
- Does not include analytics, crash reporting, or telemetry.

### Threat model:
| Threat | Mitigation |
|--------|-----------|
| Remote access to local server | Localhost-only binding (`127.0.0.1`), rejected at middleware |
| Cross-site request forgery | CSRF token required on all mutations |
| PAT/key leakage via logs | Keys never logged; config shows `***SET***` |
| PAT/key leakage via error messages | API clients strip sensitive data from errors |
| Path traversal in export | Output paths validated against `~/.shippage/pages/` prefix |
| Prompt injection via ticket data | Ticket content wrapped in XML tags; system prompt instructs Claude to ignore instructions in data |
| Template XSS in preview | iframe uses `sandbox="allow-same-origin"` — no script execution |
| SSRF via image inlining | Private IP ranges blocked before any URL fetch |

## Scope

In-scope for security reports:
- PAT or API key exposure
- Bypass of localhost-only restriction
- Path traversal in export
- CSRF bypass
- Dependency vulnerabilities (high/critical severity)

Out-of-scope:
- Social engineering
- Physical access to the machine
- Vulnerabilities in the APIs we integrate with (Linear, GitHub, Jira, Anthropic)
