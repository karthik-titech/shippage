import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  root: "src/client",
  build: {
    outDir: "../../dist/client",
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "src/shared"),
    },
  },
  server: {
    port: 5173,
    // Proxy API calls to Express in dev mode
    proxy: {
      "/api": {
        target: "http://127.0.0.1:4378",
        changeOrigin: false,
      },
    },
  },
  // Security: do not expose env vars prefixed with anything sensitive
  envPrefix: "SHIPPAGE_",
});
