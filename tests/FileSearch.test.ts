import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "../src/server.js";
import { FileSearchService } from "../src/file-search/FileSearchService.js";

const fixtureRoot = resolve("tests/.tmp-file-search");
const outsideRoot = resolve("tests/.tmp-file-search-outside");
const pdfBytes = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n");

describe("file search agent API", () => {
  beforeEach(async () => {
    await rm(fixtureRoot, { recursive: true, force: true });
    await rm(outsideRoot, { recursive: true, force: true });
    await mkdir(join(fixtureRoot, "offers"), { recursive: true });
    await writeFile(join(fixtureRoot, "offers", "Job Offer-Associate Consultant.pdf"), pdfBytes);
    await writeFile(join(fixtureRoot, "offers", "notes.txt"), "not a pdf");
    vi.stubEnv("SANDBOX_FILE_SEARCH_ROOTS", fixtureRoot);
  });

  afterEach(async () => {
    await rm(fixtureRoot, { recursive: true, force: true });
    await rm(outsideRoot, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it("returns an agent-style command trace and PDF preview URL", async () => {
    const server = buildServer();
    const response = await server.inject({
      method: "POST",
      url: "/agent/file-search",
      payload: { query: "find the Job Offer-Associate Consultant.pdf file" }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{
      status: string;
      terminal: { shell: string; executionMode: string };
      selectedMatch: { fileName: string; directory: string; previewUrl: string };
      commands: Array<{ command: string; stdout: string }>;
    }>();
    expect(body.status).toBe("found");
    expect(body.terminal).toMatchObject({ shell: "PowerShell", executionMode: "sandbox-file-search" });
    expect(body.selectedMatch.fileName).toBe("Job Offer-Associate Consultant.pdf");
    expect(body.selectedMatch.directory).toContain("offers");
    expect(body.selectedMatch.previewUrl).toMatch(/^\/agent\/files\//);
    expect(body.commands.some((command) => command.command.includes("Test-Path"))).toBe(true);
    expect(body.commands.some((command) => command.command.includes("Get-ChildItem"))).toBe(true);
    expect(body.commands.at(-1)?.stdout).toContain("Directory:");
    await server.close();
  });

  it("streams the indexed PDF inline", async () => {
    const server = buildServer();
    const search = await server.inject({
      method: "POST",
      url: "/agent/file-search",
      payload: { query: "Job Offer Associate Consultant pdf" }
    });
    const previewUrl = search.json<{ selectedMatch: { previewUrl: string } }>().selectedMatch.previewUrl;
    const preview = await server.inject({ method: "GET", url: previewUrl });

    expect(preview.statusCode).toBe(200);
    expect(preview.headers["content-type"]).toContain("application/pdf");
    expect(preview.headers["content-disposition"]).toContain("inline");
    expect(preview.body).toContain("%PDF-1.4");
    await server.close();
  });

  it("finds non-PDF files with semantic filename ranking while reporting searched roots", async () => {
    const server = buildServer();
    const response = await server.inject({
      method: "POST",
      url: "/agent/file-search",
      payload: { query: "find my offer notes text file" }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{
      status: string;
      roots: string[];
      selectedMatch: { fileName: string; extension: string; score: number; reason: string };
    }>();
    expect(body.status).toBe("found");
    expect(body.roots).toContain(fixtureRoot);
    expect(body.selectedMatch.fileName).toBe("notes.txt");
    expect(body.selectedMatch.extension).toBe(".txt");
    expect(body.selectedMatch.score).toBeGreaterThan(0);
    expect(body.selectedMatch.reason).toContain("token");
    await server.close();
  });

  it("uses safe text snippets as a semantic signal when filenames do not match the request words", async () => {
    await writeFile(join(fixtureRoot, "roadmap.md"), "# Roadmap\nInternal launch plan for OCI agent work.");
    const server = buildServer();
    const response = await server.inject({
      method: "POST",
      url: "/agent/file-search",
      payload: { query: "please send the internal launch plan" }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{
      status: string;
      selectedMatch: { fileName: string; reason: string; score: number };
    }>();
    expect(body.status).toBe("found");
    expect(body.selectedMatch.fileName).toBe("roadmap.md");
    expect(body.selectedMatch.reason).toContain("semantic content match");
    expect(body.selectedMatch.score).toBeGreaterThan(0);

    await server.close();
  });

  it("still selects a stronger exact filename match after more than twenty weaker traversal hits", async () => {
    await mkdir(join(fixtureRoot, "bulk"), { recursive: true });
    for (let index = 0; index < 25; index += 1) {
      await writeFile(join(fixtureRoot, "bulk", `aaa-quarterly-roadmap-${String(index).padStart(2, "0")}.md`), "Quarterly roadmap notes.");
    }
    await mkdir(join(fixtureRoot, "bulk", "zzz-target"), { recursive: true });
    await writeFile(join(fixtureRoot, "bulk", "zzz-target", "Quarterly Roadmap Definitive.md"), "# Quarterly Roadmap Definitive\nFinal plan.");

    const server = buildServer();
    const response = await server.inject({
      method: "POST",
      url: "/agent/file-search",
      payload: { query: "please find Quarterly Roadmap Definitive.md" }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{
      status: string;
      selectedMatch: { fileName: string; score: number; reason: string };
    }>();
    expect(body.status).toBe("found");
    expect(body.selectedMatch.fileName).toBe("Quarterly Roadmap Definitive.md");
    expect(body.selectedMatch.score).toBeGreaterThanOrEqual(0.99);
    expect(body.selectedMatch.reason).toMatch(/Exact filename match|lexical/);

    await server.close();
  });

  it("ranks a strong later candidate even after more than the candidate retention limit", async () => {
    const crowdedRoot = join(fixtureRoot, "crowded");
    await mkdir(crowdedRoot, { recursive: true });
    for (let index = 0; index < 275; index += 1) {
      await writeFile(join(crowdedRoot, `alpha-background-${String(index).padStart(2, "0")}.md`), "generic alpha notes");
    }
    await mkdir(join(crowdedRoot, "zz-target"), { recursive: true });
    await writeFile(join(crowdedRoot, "zz-target", "Alpha Launch Architecture.md"), "# Alpha Launch Architecture\nExact requested architecture plan.");

    const server = buildServer();
    const response = await server.inject({
      method: "POST",
      url: "/agent/file-search",
      payload: { query: "please send alpha launch architecture markdown" }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ status: string; selectedMatch: { fileName: string; score: number }; matches: Array<{ fileName: string }> }>();
    expect(body.status).toBe("found");
    expect(body.selectedMatch.fileName).toBe("Alpha Launch Architecture.md");
    expect(body.matches.some((match) => match.fileName === "Alpha Launch Architecture.md")).toBe(true);
    await server.close();
  }, 15000);

  it("normalizes noisy LLM filetype terms while finding NonPO invoice PDFs", async () => {
    await writeFile(join(fixtureRoot, "Non-PO invoice India.pdf"), pdfBytes);

    const server = buildServer();
    const response = await server.inject({
      method: "POST",
      url: "/agent/file-search",
      payload: { query: "Find NonPO invoice India filetype pdf non po" }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{
      status: string;
      selectedMatch: { fileName: string };
      commands: Array<{ command: string }>;
    }>();
    expect(body.status).toBe("found");
    expect(body.selectedMatch.fileName).toBe("Non-PO invoice India.pdf");
    expect(body.commands.some((command) => command.command.includes("filetype"))).toBe(false);

    await server.close();
  });

  it("checks generated underscore and compact filename variants before recursive scanning", async () => {
    vi.stubEnv("FILE_SEARCH_ROOT_TIMEOUT_MS", "1");
    await writeFile(join(fixtureRoot, "NonPO_Invoice_India.pdf"), pdfBytes);

    const server = buildServer();
    const response = await server.inject({
      method: "POST",
      url: "/agent/file-search",
      payload: { query: "Find NonPO invoice India pdf file from the local data" }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{
      status: string;
      selectedMatch: { fileName: string; previewUrl: string };
      commands: Array<{ command: string; stdout: string }>;
    }>();
    expect(body.status).toBe("found");
    expect(body.selectedMatch.fileName).toBe("NonPO_Invoice_India.pdf");
    expect(body.selectedMatch.previewUrl).toMatch(/^\/agent\/files\//);
    expect(body.commands.some((command) => command.command.includes("nonpo_invoice_india.pdf") && command.stdout.includes("NonPO_Invoice_India.pdf"))).toBe(true);

    await server.close();
  });

  it("does not spend the PDF search file budget on unrelated non-PDF files before a later PDF match", async () => {
    vi.stubEnv("FILE_SEARCH_MAX_FILES_PER_ROOT", "3");
    const crowdedRoot = join(fixtureRoot, "pdf-late");
    await mkdir(crowdedRoot, { recursive: true });
    for (let index = 0; index < 25; index += 1) {
      await writeFile(join(crowdedRoot, `unrelated-${index}.txt`), "not a PDF");
    }
    await writeFile(join(crowdedRoot, "India Vendor NonPO Invoice April.pdf"), pdfBytes);

    const search = new FileSearchService();
    const result = await search.search("Find NonPO invoice India pdf file");

    expect(result.status).toBe("found");
    expect(result.selectedMatch?.fileName).toBe("India Vendor NonPO Invoice April.pdf");
    expect(result.selectedMatch?.reason).toContain("lexical path match");
  });

  it("stops large root walks at the configured search budget and reports partial results", async () => {
    vi.stubEnv("FILE_SEARCH_MAX_FILES_PER_ROOT", "3");
    await mkdir(join(fixtureRoot, "many"), { recursive: true });
    for (let index = 0; index < 10; index += 1) {
      await writeFile(join(fixtureRoot, "many", `background-${index}.pdf`), pdfBytes);
    }

    const search = new FileSearchService();
    const result = await search.search("missing invoice pdf");

    expect(result.status).toBe("not_found");
    expect(result.commands.some((command) => command.stderr?.includes("search budget"))).toBe(true);
    expect(result.commands.some((command) => command.stdout.includes("Results may be partial"))).toBe(true);
  });

  it("does not serve unknown file IDs", async () => {
    const server = buildServer();
    const response = await server.inject({ method: "GET", url: "/agent/files/not-indexed" });

    expect(response.statusCode).toBe(404);
    await server.close();
  });

  it("does not follow symlinks or junctions outside the configured search roots", async () => {
    await mkdir(outsideRoot, { recursive: true });
    await writeFile(join(outsideRoot, "leaked-roadmap.pdf"), pdfBytes);
    try {
      await symlink(outsideRoot, join(fixtureRoot, "linked-outside"), "junction");
    } catch {
      return;
    }

    const server = buildServer();
    const response = await server.inject({
      method: "POST",
      url: "/agent/file-search",
      payload: { query: "find leaked roadmap pdf" }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ status: string; matches: Array<{ fileName: string; directory: string }> }>();
    expect(body.matches.some((match) => match.fileName === "leaked-roadmap.pdf")).toBe(false);
    await server.close();
  });

  it("ignores agent-requested semantic search roots outside configured roots unless full-drive mode is enabled", async () => {
    await mkdir(outsideRoot, { recursive: true });
    await writeFile(join(outsideRoot, "outside-roadmap.pdf"), pdfBytes);
    const search = new FileSearchService();

    const result = await search.search("outside roadmap pdf", undefined, { roots: [outsideRoot] });

    expect(result.roots).toContain(fixtureRoot);
    expect(result.roots).not.toContain(outsideRoot);
    expect(result.matches.some((match) => match.fileName === "outside-roadmap.pdf")).toBe(false);
  });
});
