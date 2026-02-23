# src/server/security/ — Security Middleware

All middleware in this directory is registered **before** any route handlers in `src/server/index.ts`. Order matters: `localhostOnly` is always first.

---

## localhost-only.ts

**Why it exists:** ShipPage is a local tool. Any request from a non-localhost IP is by definition unexpected and likely hostile (e.g. a malicious website on the same network attempting to reach the locally-running server).

### How it works

```typescript
// Middleware checks req.socket.remoteAddress (not spoofable via headers)
const allowed = ["127.0.0.1", "::1", "::ffff:127.0.0.1"];

if (!allowed.includes(remoteAddress)) {
  res.status(403).json({ error: "Access denied." });
  return;
}
next();
```

The middleware uses `req.socket.remoteAddress` (the actual TCP connection source), **not** `X-Forwarded-For` or other headers that can be spoofed. This means:
- Direct browser requests on the same machine: ✅ allowed
- Requests from another machine on the LAN: ❌ blocked (even with the right IP in headers)
- DNS rebinding attacks: ❌ blocked at the IP level

---

## csrf.ts — CSRF Protection

**Why it exists:** Even on localhost, a malicious webpage loaded in the same browser could make cross-origin requests to `http://localhost:4378`. CSRF tokens prevent this.

### Architecture

```
Server startup:
  └── generateCsrfToken() → crypto.randomBytes(32).toString("hex")
      └── stored in module-level variable (process lifetime)

GET /api/csrf-token:
  └── Returns { token: "..." }  ← no CSRF check on this endpoint (safe: GET + no side effects)

GET index.html:
  └── injectCsrfToken(html) replaces `__CSRF_TOKEN__` placeholder with the real token
      └── React app reads window.__CSRF_TOKEN__ and includes it in all mutation headers

POST/PATCH/DELETE /api/*:
  └── csrfProtection middleware:
      ├── Read "x-csrf-token" header
      ├── Compare to stored token (timing-safe: crypto.timingSafeEqual)
      └── 403 if missing or wrong
```

### Why a single rotating token is sufficient

ShipPage has no sessions and no concurrent users (it's a single-user local tool). A process-lifetime token is appropriate. If the process restarts, the frontend (which reads the token from the injected `window.__CSRF_TOKEN__` on page load) will naturally get the new token.

---

## validate.ts — Input Validation Utilities

**Why it exists:** User-supplied values (release names, template names, export paths) must be sanitized before they're used in file system operations.

### Functions

#### `validateExportPath(exportPath): boolean`

Ensures an export path resolves within `~/.shippage/pages/`. Prevents path traversal attacks like `../../etc/passwd`.

```typescript
// Algorithm:
const resolved = path.resolve(exportPath);
const allowed  = path.resolve(os.homedir(), ".shippage", "pages");
return resolved.startsWith(allowed + path.sep);
```

#### `validateTemplateName(name): boolean`

Template names are used to build file paths. This function rejects anything that could escape the template directory.

```typescript
// Allowlist: alphanumeric, hyphens, underscores only
// Max length: 64 characters
// Rejects: path separators, dots, shell metacharacters, HTML tags
const SAFE = /^[a-zA-Z0-9_-]{1,64}$/;
return SAFE.test(name);
```

#### `sanitizeDirectoryName(name): string`

Converts a release name (potentially containing any characters) to a safe directory name.

```typescript
// Algorithm:
// 1. Remove leading dots and slashes (path traversal)
// 2. Replace any non-alphanumeric/hyphen/dot/underscore char with "-"
// 3. Collapse consecutive hyphens
// 4. Trim hyphens from start/end
// 5. Truncate to 128 characters
```

Example: `"../../../evil"` → `"evil"`, `"release<script>"` → `"release-script-"`
