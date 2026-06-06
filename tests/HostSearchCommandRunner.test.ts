import { describe, expect, it } from "vitest";
import { HostSearchCommandRunner } from "../src/host/HostSearchCommandRunner.js";

describe("host search command policy", () => {
  const runner = new HostSearchCommandRunner();

  it("allows a simple read-only filtered file search command", () => {
    const decision = runner.evaluate('Get-ChildItem -Path "C:\\Users\\Skanda Ganesha L\\Downloads" -Filter "*invoice*.pdf" -Recurse -File');

    expect(decision.allowed).toBe(true);
  });

  it("blocks generated pipelines and chained commands before execution", () => {
    const piped = runner.evaluate(
      'Get-ChildItem -Path "C:\\Users\\Skanda Ganesha L\\Downloads" -Recurse -File -Filter *.pdf | Where-Object { $_.Name -match "invoice" }'
    );
    const chained = runner.evaluate(
      'where.exe /r "C:\\Users\\Skanda Ganesha L\\Documents" *.pdf & where.exe /r "C:\\Users\\Skanda Ganesha L\\Downloads" *.pdf'
    );

    expect(piped.allowed).toBe(false);
    expect(piped.reason).toContain("single simple read-only command");
    expect(chained.allowed).toBe(false);
  });

  it("blocks broad recursive PDF scans without request-specific filters", () => {
    const decision = runner.evaluate('where.exe /r "C:\\Users\\Skanda Ganesha L\\Documents" *.pdf');

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("Broad recursive PDF scans");
  });
});
