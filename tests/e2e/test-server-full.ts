/**
 * Full-stack test server for Playwright browser (UI) e2e tests.
 * Runs WITHOUT devMode so the server also serves the built React frontend
 * from dist/client/. Requires `pnpm build` to be run first.
 */
import { createServer } from "../../src/server/index.js";

const { start } = await createServer({ devMode: false });
await start(3999);
