import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    include: ["ui/src/tests/**/*.test.{ts,tsx}"],
    setupFiles: ["./ui/src/tests/setup.ts"],
    globals: true,
    css: true,
    testTimeout: 15000
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
      "~/components": path.resolve(__dirname, "components"),
      "~/lib": path.resolve(__dirname, "lib"),
      "~/packages/ai": path.resolve(__dirname, "src/components/ai"),
      "~": path.resolve(__dirname)
    }
  }
});
