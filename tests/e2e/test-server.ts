/**
 * Lightweight test server entry point for Playwright e2e tests.
 * Runs the Express server in devMode (no frontend serving) on port 3999.
 */
import { createServer } from "../../src/server/index.js";

const { start } = await createServer({ devMode: true });
await start(3999);
