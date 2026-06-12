import { describe, expect, it } from "vitest";
import { RuleBasedQueryRewriter, LlmQueryRewriter, createQueryRewriter } from "../src/intent/QueryRewriter.js";
import { FallbackLlmProvider } from "../src/oci/LlmProvider.js";

describe("RuleBasedQueryRewriter", () => {
  const rewriter = new RuleBasedQueryRewriter();

  it("normalizes a simple file request", () => {
    const result = rewriter.rewrite("find the API design PDF");
    expect(result.normalized).toBe("api design pdf");
    expect(result.lexicalQuery).toBe("api design");
    expect(result.semanticQuery).toContain("api");
    expect(result.semanticQuery).toContain("design");
    expect(result.semanticQuery).toContain("pdf");
    expect(result.fileTypeHints).toContain("pdf");
    expect(result.extensions).toContain("pdf");
    expect(result.exactFilename).toBeNull();
  });

  it("extracts exact filenames for filename-first file request routing", () => {
    const result = rewriter.rewrite("Send me Job Offer-Associate Consultant.pdf file");

    expect(result.exactFilename).toBe("Job Offer-Associate Consultant.pdf");
    expect(result.extensions).toContain("pdf");
    expect(result.lexicalQuery).toContain("job");
    expect(result.semanticQuery).toContain("pdf");
  });

  it("extracts extensions from query", () => {
    const result = rewriter.rewrite("send me the quarterly report pptx");
    expect(result.fileTypeHints).toContain("pptx");
    expect(result.extensions).toContain("ppt");
    expect(result.extensions).toContain("pptx");
    expect(result.projectHints).toContain("quarterly");
    expect(result.projectHints).toContain("report");
    expect(result.projectHints).not.toContain("send");
    expect(result.projectHints).not.toContain("me");
  });

  it("handles multiple file types", () => {
    const result = rewriter.rewrite("find the csv or xlsx file");
    expect(result.fileTypeHints).toEqual(expect.arrayContaining(["csv", "xlsx"]));
    expect(result.extensions).toEqual(expect.arrayContaining(["csv", "xls", "xlsx"]));
  });

  it("detects date hints", () => {
    const result = rewriter.rewrite("show me the report from yesterday");
    expect(result.dateHint).toBe("yesterday");
  });

  it("detects year dates", () => {
    const result = rewriter.rewrite("budget 2025 spreadsheet");
    expect(result.dateHint).toBe("2025");
  });

  it("returns empty fields for empty query", () => {
    const result = rewriter.rewrite("");
    expect(result.normalized).toBe("");
    expect(result.lexicalQuery).toBe("");
    expect(result.semanticQuery).toBe("");
    expect(result.fileTypeHints).toEqual([]);
    expect(result.projectHints).toEqual([]);
    expect(result.exactFilename).toBeNull();
  });

  it("preserves original text", () => {
    const original = "send me the Client A API Design Final v3 PDF";
    const result = rewriter.rewrite(original);
    expect(result.original).toBe(original);
  });

  it("extracts project hints from non-extension meaningful words", () => {
    const result = rewriter.rewrite("find the Acme Corp invoice pdf");
    expect(result.projectHints).toContain("acme");
    expect(result.projectHints).toContain("corp");
    expect(result.projectHints).toContain("invoice");
    expect(result.projectHints).not.toContain("pdf");
  });

  it("builds lexical query as clean alphanumeric terms only", () => {
    const result = rewriter.rewrite("find file named report final v2 pdf");
    expect(result.lexicalQuery).toContain("report");
    expect(result.lexicalQuery).toContain("final");
    expect(result.lexicalQuery).not.toContain("find");
    expect(result.lexicalQuery).not.toContain("file");
  });

  it("builds semantic query including file type hints", () => {
    const result = rewriter.rewrite("client budget spreadsheet xlsx");
    expect(result.semanticQuery).toContain("client");
    expect(result.semanticQuery).toContain("budget");
    expect(result.semanticQuery).toContain("spreadsheet");
    expect(result.semanticQuery).toContain("xlsx");
  });
});

describe("LlmQueryRewriter", () => {
  it("falls through to rule-based when LLM unavailable", () => {
    const ruleBased = new RuleBasedQueryRewriter();
    const llm = new FallbackLlmProvider(() => { throw new Error("no llm"); });
    const rewriter = new LlmQueryRewriter(ruleBased, llm);
    const result = rewriter.rewrite("find the report pdf");
    expect(result.normalized).toBe("report pdf");
  });
});

describe("createQueryRewriter", () => {
  it("returns LlmQueryRewriter wrapper when OCI env not set (uses rule-based path)", () => {
    const instance = createQueryRewriter();
    // Without OCI config, factory returns LlmQueryRewriter that delegates to rule-based
    expect(instance).toBeInstanceOf(LlmQueryRewriter);
    const result = instance.rewrite("find the report pdf");
    expect(result.normalized).toBe("report pdf");
  });
});
