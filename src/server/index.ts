import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { localhostOnly } from "./security/localhost-only.js";
import { csrfProtection, injectCsrfToken, getOrCreateCsrfToken } from "./security/csrf.js";
import { configRouter } from "./routes/config.js";
import { integrationsRouter } from "./routes/integrations.js";
import { generateRouter } from "./routes/generate.js";
import { releasesRouter } from "./routes/releases.js";
import { exportRouter } from "./routes/export.js";
import { ensureShipPageDirs } from "./config/store.js";
import { getDb, closeDb } from "./db/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// eslint-disable-next-line @typescript-eslint/require-await
export async function createServer(options?: { devMode?: boolean }): Promise<{
  app: express.Application;
  start: (port: number) => Promise<number>;
}> {
  // Ensure data directories exist on server start
  ensureShipPageDirs();

  // Initialize database (runs migrations)
  getDb();

  const app = express();

  // ----------------------------------------------------------------
  // 1. SECURITY MIDDLEWARE — must be first
  // ----------------------------------------------------------------
  app.use(localhostOnly);

  // ----------------------------------------------------------------
  // 2. CORS — only allow localhost origins
  // ----------------------------------------------------------------
  app.use(
    cors({
      origin: (origin, callback) => {
        // Allow: no origin (same-origin requests), localhost
        if (
          !origin ||
          origin.startsWith("http://localhost:") ||
          origin.startsWith("http://127.0.0.1:")
        ) {
          callback(null, true);
        } else {
          callback(new Error("Not allowed by CORS policy."));
        }
      },
      credentials: false, // We use CSRF tokens, not cookies
    })
  );

  // ----------------------------------------------------------------
  // 3. Body parsing
  // ----------------------------------------------------------------
  app.use(express.json({ limit: "1mb" })); // Limit request body size
  app.use(express.urlencoded({ extended: false, limit: "1mb" }));

  // ----------------------------------------------------------------
  // 4. CSRF protection for all mutation endpoints
  // ----------------------------------------------------------------
  app.use("/api", csrfProtection);

  // ----------------------------------------------------------------
  // 5. API routes
  // ----------------------------------------------------------------
  app.use("/api/config", configRouter);
  app.use("/api/integrations", integrationsRouter);
  app.use("/api/generate", generateRouter);
  app.use("/api/releases", releasesRouter);
  app.use("/api/export", exportRouter);

  // Expose CSRF token endpoint (GET — exempt from CSRF check)
  app.get("/api/csrf-token", (_req, res) => {
    res.json({ token: getOrCreateCsrfToken() });
  });

  // ----------------------------------------------------------------
  // 6. Frontend serving
  // ----------------------------------------------------------------
  if (options?.devMode) {
    // In dev mode, Vite serves the frontend. Just provide a health check.
    app.get("/", (_req, res) => res.json({ status: "dev mode — frontend at :5173" }));
  } else {
    const clientDir = path.resolve(__dirname, "../../client");

    if (!fs.existsSync(clientDir)) {
      console.warn(
        "[ShipPage] Frontend build not found. Run `pnpm build` first, or use `shippage --dev`."
      );
    } else {
      app.use(express.static(clientDir, { index: false }));

      // Serve index.html with CSRF token injected for all non-API routes (SPA)
      app.get(/^(?!\/api).*$/, (_req, res) => {
        const indexPath = path.join(clientDir, "index.html");
        if (!fs.existsSync(indexPath)) {
          res.status(503).send("Frontend not built. Run `pnpm build` first.");
          return;
        }
        const html = fs.readFileSync(indexPath, "utf-8");
        const htmlWithCsrf = injectCsrfToken(html);
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        // Security headers
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("X-Frame-Options", "SAMEORIGIN");
        res.setHeader("Referrer-Policy", "same-origin");
        res.send(htmlWithCsrf);
      });
    }
  }

  // ----------------------------------------------------------------
  // 7. Error handler
  // ----------------------------------------------------------------
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error("[ShipPage] Unhandled error:", err.message);
    // Never expose stack traces to the client
    res.status(500).json({ error: "Internal server error." });
  });

  const start = (preferredPort: number): Promise<number> => {
    return new Promise((resolve, reject) => {
      const tryPort = (port: number, attemptsLeft: number) => {
        const server = app.listen(port, "127.0.0.1", () => {
          console.info(`[ShipPage] Server running at http://127.0.0.1:${port}`);
          resolve(port);
        });

        server.on("error", (err: NodeJS.ErrnoException) => {
          if (err.code === "EADDRINUSE" && attemptsLeft > 0) {
            console.warn(`[ShipPage] Port ${port} in use, trying ${port + 1}...`);
            tryPort(port + 1, attemptsLeft - 1);
          } else {
            reject(new Error(`Could not find an available port starting from ${preferredPort}.`));
          }
        });
      };

      tryPort(preferredPort, 5);
    });
  };

  return { app, start };
}

// ----------------------------------------------------------------
// Graceful shutdown
// ----------------------------------------------------------------
function shutdown(signal: string) {
  console.info(`\n[ShipPage] Received ${signal}. Shutting down...`);
  closeDb();
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
