import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetDb, getDb } from "../src/db/connection.js";
import { FileSearchService } from "../src/file-search/FileSearchService.js";
import { parseFileRequest } from "../src/intent/FileRequestParser.js";
import { FileRequestSearch, searchFileRequest, searchFileRequestIndex } from "../src/retrieval/FileRequestSearch.js";
import { resolveFileRequestCandidates } from "../src/runtime/FileRequestCandidateResolver.js";
import { buildServer } from "../src/server.js";

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "file-request-search-"));
  process.env.AGENTIC_DB_PATH = join(tmpRoot, "agent.db");
  process.env.SANDBOX_FILE_SEARCH_ROOTS = tmpRoot;
  _resetDb();
});

afterEach(() => {
  _resetDb();
  delete process.env.AGENTIC_DB_PATH;
  delete process.env.SANDBOX_FILE_SEARCH_ROOTS;
  vi.unstubAllEnvs();
  try { rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe("remote file request search", () => {
  it("finds exact filename matches from the SQLite index before fallback search", () => {
    const filePath = join(tmpRoot, "Job Offer-Associate Consultant.pdf");
    writeFileSync(filePath, "%PDF-1.4 indexed offer");
    const now = new Date().toISOString();
    getDb().prepare(`
      INSERT INTO file_index
        (root_id, file_path, display_path, file_name, extension, mime_type, size_bytes, modified_at, indexed_text, metadata_json, last_indexed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run("root-test", filePath, "Downloads/Job Offer-Associate Consultant.pdf", "Job Offer-Associate Consultant.pdf", ".pdf", "application/pdf", 22, now, "", "{}", now);

    const parsed = parseFileRequest("Send me Job Offer-Associate Consultant.pdf file");
    const matches = searchFileRequestIndex(parsed, { limit: 5 });

    expect(matches).toContainEqual(expect.objectContaining({
      fileName: "Job Offer-Associate Consultant.pdf",
      reason: "exact-filename"
    }));

    const directMatches = searchFileRequest(parsed, { limit: 5 });
    const classMatches = new FileRequestSearch().searchFileRequest(parsed, { limit: 5 });
    expect(directMatches[0]?.fileName).toBe("Job Offer-Associate Consultant.pdf");
    expect(classMatches[0]?.fileName).toBe("Job Offer-Associate Consultant.pdf");
  });

  it("falls back to live allowed-root search when the SQLite index is empty", async () => {
    writeFileSync(join(tmpRoot, "Job Offer-Associate Consultant.pdf"), "%PDF-1.4 live offer");

    const resolved = await resolveFileRequestCandidates(
      "Send me Job Offer-Associate Consultant.pdf file",
      new FileSearchService(),
      { limit: 5 }
    );

    expect(resolved.source).toBe("live");
    expect(resolved.candidates).toContainEqual(expect.objectContaining({
      fileName: "Job Offer-Associate Consultant.pdf",
      displayPath: "Local file / Job Offer-Associate Consultant.pdf",
      boundSha256: expect.stringMatching(/^[a-f0-9]{64}$/)
    }));
    expect(JSON.stringify(resolved.candidates.map((candidate) => candidate.displayPath))).not.toContain(tmpRoot);
  });

  it("keeps requested PDFs in primary candidates and hides other extensions as low confidence", async () => {
    const pdfPath = join(tmpRoot, "Harassment Certificate.pdf");
    const docxPath = join(tmpRoot, "Harassment Certificate.docx");
    writeFileSync(pdfPath, "%PDF-1.4 certificate");
    writeFileSync(docxPath, "docx certificate");
    const now = new Date().toISOString();
    const insert = getDb().prepare(`
      INSERT INTO file_index
        (root_id, file_path, display_path, file_name, extension, mime_type, size_bytes, modified_at, indexed_text, metadata_json, last_indexed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insert.run("root-test", pdfPath, "Docs/Harassment Certificate.pdf", "Harassment Certificate.pdf", ".pdf", "application/pdf", 22, now, "", "{}", now);
    insert.run("root-test", docxPath, "Docs/Harassment Certificate.docx", "Harassment Certificate.docx", ".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", 16, now, "", "{}", now);

    const resolved = await resolveFileRequestCandidates(
      "Ask Docin to send me Harassment Certificate pdf file",
      new FileSearchService(),
      { limit: 5 }
    );

    expect(resolved.candidates).toContainEqual(expect.objectContaining({
      fileName: "Harassment Certificate.pdf",
      extension: ".pdf"
    }));
    expect(resolved.candidates.some((candidate) => candidate.extension !== ".pdf")).toBe(false);
    expect(resolved.lowConfidenceCandidates).toContainEqual(expect.objectContaining({
      fileName: "Harassment Certificate.docx",
      extension: ".docx"
    }));
  }, 15_000);

  it("matches case-insensitive exact filenames", () => {
    const filePath = join(tmpRoot, "Harassment Certificate.PDF");
    writeFileSync(filePath, "%PDF-1.4 certificate");
    const now = new Date().toISOString();
    getDb().prepare(`
      INSERT INTO file_index
        (root_id, file_path, display_path, file_name, extension, mime_type, size_bytes, modified_at, indexed_text, metadata_json, last_indexed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run("root-test", filePath, "Docs/Harassment Certificate.PDF", "Harassment Certificate.PDF", ".pdf", "application/pdf", 22, now, "", "{}", now);

    const matches = searchFileRequestIndex(parseFileRequest("send me harassment certificate.pdf file"), { limit: 5 });

    expect(matches[0]).toMatchObject({
      fileName: "Harassment Certificate.PDF",
      reason: "exact-filename"
    });
  }, 15_000);

  it("returns safe diagnostics for file request search debugging", async () => {
    writeFileSync(join(tmpRoot, "Job Offer-Associate Consultant.pdf"), "%PDF-1.4 debug offer");
    const server = buildServer();

    const response = await server.inject({
      method: "GET",
      url: `/files/search/debug?query=${encodeURIComponent("Send me Job Offer-Associate Consultant.pdf file")}`
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{
      parsed: { exactFilename: string | null };
      indexedCount: number;
      searchedRoots: string[];
      finalCandidates: Array<{ file_name: string; display_path: string }>;
      source: string;
    }>();
    expect(body.parsed.exactFilename).toBe("Job Offer-Associate Consultant.pdf");
    expect(body.indexedCount).toBe(0);
    expect(body.searchedRoots).toContain(tmpRoot);
    expect(body.source).toBe("live");
    expect(body.finalCandidates).toContainEqual(expect.objectContaining({
      file_name: "Job Offer-Associate Consultant.pdf",
      display_path: "Local file / Job Offer-Associate Consultant.pdf"
    }));
    expect(JSON.stringify(body.finalCandidates)).not.toContain(tmpRoot);
    await server.close();
  }, 15_000);
});
