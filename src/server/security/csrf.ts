import crypto from "crypto";
import fs from "fs";
import path from "path";
import type { Request, Response, NextFunction } from "express";
import { SHIPPAGE_DIR } from "../config/store.js";

// ----------------------------------------------------------------
// CSRF Protection for the local API.
//
// Why CSRF matters even for a localhost-only server:
//   - The server accepts connections from ANY localhost origin (any port).
//   - A malicious npm package or local web app on port 3000 could make
//     fetch() calls to localhost:4378/api/* and trigger actions
//     (AI generation, config changes) without the user's knowledge.
//   - The CSRF token prevents this because third-party pages cannot
//     read the token (Same-Origin Policy blocks it).
//
// Implementation:
//   1. Generate a random token at server startup
//   2. Write to ~/.shippage/.csrf-token (0600 permissions)
//   3. Inject into index.html as window.__SHIPPAGE_CSRF__
//   4. Frontend includes it as X-CSRF-Token header on all mutations
//   5. Middleware validates it on POST/PUT/DELETE/PATCH
// ----------------------------------------------------------------

const CSRF_TOKEN_PATH = path.join(SHIPPAGE_DIR, ".csrf-token");
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

let _csrfToken: string | null = null;

export function getOrCreateCsrfToken(): string {
  if (_csrfToken) return _csrfToken;

  // Generate a new 32-byte cryptographically random token
  _csrfToken = crypto.randomBytes(32).toString("hex");

  // Persist so it survives hot-reloads (but regenerate on server restart in prod)
  if (fs.existsSync(SHIPPAGE_DIR)) {
    fs.writeFileSync(CSRF_TOKEN_PATH, _csrfToken, { mode: 0o600 });
  }

  return _csrfToken;
}

export function csrfProtection(req: Request, res: Response, next: NextFunction): void {
  // Safe methods don't need CSRF protection
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }

  const token = getOrCreateCsrfToken();
  const requestToken = req.headers["x-csrf-token"] as string | undefined;

  if (!requestToken || !crypto.timingSafeEqual(Buffer.from(requestToken), Buffer.from(token))) {
    res.status(403).json({
      error: "Invalid or missing CSRF token.",
      code: "CSRF_VALIDATION_FAILED",
    });
    return;
  }

  next();
}

// ----------------------------------------------------------------
// Inject the CSRF token into the served HTML so the frontend can
// read it and include it in API requests.
// Called by the server when serving index.html.
// ----------------------------------------------------------------
export function injectCsrfToken(html: string): string {
  const token = getOrCreateCsrfToken();
  const script = `<script>window.__SHIPPAGE_CSRF__ = "${token}";</script>`;
  return html.replace("</head>", `${script}\n</head>`);
}
