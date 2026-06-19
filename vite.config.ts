import path from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type ProxyOptions } from "vite";

const localAgentTarget =
  process.env.VITE_LOCAL_AGENT_URL ??
  `http://127.0.0.1:${process.env.AGENTIC_AGENT_PORT ?? process.env.SANDBOX_PORT ?? 3399}`;

const localAgentProxy = (): ProxyOptions => ({
  target: localAgentTarget,
  changeOrigin: true,
  secure: false,
  cookieDomainRewrite: "",
  cookiePathRewrite: "/"
});

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
      "/agent": localAgentProxy(),
      "/a2a": localAgentProxy(),
      "/audit": localAgentProxy(),
      "/approvals": localAgentProxy(),
      "/chat": localAgentProxy(),
      "/cloud": localAgentProxy(),
      "/events": localAgentProxy(),
      "/health": localAgentProxy(),
      "/local-ui-session": localAgentProxy(),
      "/manifest.webmanifest": localAgentProxy(),
      "/search": localAgentProxy(),
      "/missions": localAgentProxy(),
      "/redactions": localAgentProxy(),
      "/notifications": localAgentProxy(),
      "/policy": localAgentProxy(),
      "/biometric": localAgentProxy(),
      "/relay": localAgentProxy(),
      "/storage": localAgentProxy()
    }
  }
});
