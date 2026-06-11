import path from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

const localAgentTarget =
  process.env.VITE_LOCAL_AGENT_URL ??
  `http://127.0.0.1:${process.env.AGENTIC_AGENT_PORT ?? process.env.SANDBOX_PORT ?? 3399}`;

export default defineConfig({
  root: "ui",
  publicDir: false,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
      "~/components": path.resolve(__dirname, "components"),
      "~/lib": path.resolve(__dirname, "lib"),
      "~/packages/ai": path.resolve(__dirname, "src/components/ai"),
      "~": path.resolve(__dirname)
    }
  },
  build: {
    outDir: "../public",
    emptyOutDir: true
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/agent": localAgentTarget,
      "/audit": localAgentTarget,
      "/approvals": localAgentTarget,
      "/chat": localAgentTarget,
      "/cloud": localAgentTarget,
      "/health": localAgentTarget,
      "/manifest.webmanifest": localAgentTarget,
      "/search": localAgentTarget,
      "/missions": localAgentTarget,
      "/redactions": localAgentTarget,
      "/notifications": localAgentTarget,
      "/policy": localAgentTarget,
      "/biometric": localAgentTarget,
      "/relay": localAgentTarget,
      "/storage": localAgentTarget
    }
  }
});
