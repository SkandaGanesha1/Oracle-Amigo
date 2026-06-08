import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  expect: {
    timeout: 5_000
  },
  use: {
    baseURL: "http://127.0.0.1:3427",
    trace: "retain-on-failure"
  },
  webServer: {
    command: "node --import tsx src/server.ts",
    url: "http://127.0.0.1:3427/health",
    reuseExistingServer: true,
    timeout: 30_000,
    env: {
      SANDBOX_PORT: "3427",
      SANDBOX_DRY_RUN: "true"
    }
  }
});
