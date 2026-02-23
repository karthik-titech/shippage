import type { Request, Response, NextFunction } from "express";

// ----------------------------------------------------------------
// CRITICAL SECURITY MIDDLEWARE — must be registered FIRST.
//
// Rejects all requests that don't originate from localhost.
// This prevents any other machine on the network from accessing
// the local ShipPage server (which has access to PATs and API keys).
//
// Attack scenario prevented:
//   - User is on public WiFi
//   - Attacker scans subnet and finds port 4378 open
//   - Without this middleware, attacker could trigger AI generation
//     (costs user money), read release history, or exfiltrate config
// ----------------------------------------------------------------

const LOCALHOST_ADDRESSES = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

export function localhostOnly(req: Request, res: Response, next: NextFunction): void {
  const remoteAddress = req.socket.remoteAddress ?? "";

  if (LOCALHOST_ADDRESSES.has(remoteAddress)) {
    next();
    return;
  }

  // Log the attempted remote access (helps with debugging) but don't
  // include any request details that could leak information
  console.warn(
    `[ShipPage] Blocked non-localhost connection attempt from ${remoteAddress}. ` +
      `ShipPage only accepts connections from localhost (127.0.0.1).`
  );

  res.status(403).json({
    error: "ShipPage only accepts connections from localhost.",
    code: "REMOTE_ACCESS_BLOCKED",
  });
}
