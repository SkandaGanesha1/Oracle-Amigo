import { describe, expect, it, vi } from "vitest";
import { runGeneratedCodeSafetyDemo } from "../src/demo/DemoUseCases.js";

describe("demo use case", () => {
  it("runs in dry-run mode", async () => {
    vi.stubEnv("SANDBOX_DRY_RUN", "true");
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await runGeneratedCodeSafetyDemo();
    expect(spy.mock.calls.some(([line]) => String(line).includes("Dangerous command result: blocked"))).toBe(true);
    spy.mockRestore();
    vi.unstubAllEnvs();
  });
});
