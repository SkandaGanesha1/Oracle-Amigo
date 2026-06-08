import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root,
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 30000,
    pool: "forks"
  }
});
