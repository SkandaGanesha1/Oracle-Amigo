import { describe, expect, it } from "vitest";
import { FileRequestParser, parseFileRequest } from "../src/intent/FileRequestParser.js";

describe("file request parser", () => {
  it("extracts exact filenames from conversational requests", () => {
    const parsed = parseFileRequest("Send me Job Offer-Associate Consultant.pdf file");

    expect(parsed.exactFilename).toBe("Job Offer-Associate Consultant.pdf");
    expect(parsed.extensions).toContain(".pdf");
    expect(parsed.cleanQuery).toBe("job offer associate consultant");
    expect(parsed.requestWordsRemoved).toEqual(expect.arrayContaining(["send", "me"]));
    expect(parsed.confidence).toBeGreaterThanOrEqual(0.9);
    expect(parsed.confidenceReason).toBe("filename");
  });

  it("keeps useful keywords when no exact filename is present", () => {
    const parsed = parseFileRequest("please find the latest associate consultant offer pdf");

    expect(parsed.exactFilename).toBeNull();
    expect(parsed.extensions).toContain(".pdf");
    expect(parsed.keywords).toEqual(expect.arrayContaining(["latest", "associate", "consultant", "offer"]));
    expect(parsed.requestWordsRemoved).toEqual(expect.arrayContaining(["please", "find", "the"]));
    expect(parsed.confidence).toBeGreaterThan(0.5);
  });

  it("removes remote target words and extracts pdf extension from ask requests", () => {
    const parsed = parseFileRequest("Ask Docin to send me Harassment Certificate pdf file");

    expect(parsed.exactFilename).toBeNull();
    expect(parsed.extensions).toContain(".pdf");
    expect(parsed.cleanQuery).toBe("harassment certificate");
    expect(parsed.keywords).toEqual(["harassment", "certificate"]);
    expect(parsed.requestWordsRemoved).toEqual(expect.arrayContaining(["remote_target", "send", "me", "pdf", "file"]));
  });

  it("extracts exact filenames before trailing from-target clauses", () => {
    const parsed = parseFileRequest("Request NonPO invoice india.pdf from Docin");

    expect(parsed.exactFilename).toBe("NonPO invoice india.pdf");
    expect(parsed.extensions).toContain(".pdf");
    expect(parsed.cleanQuery).toBe("nonpo invoice india");
    expect(parsed.requestWordsRemoved).toContain("remote_target");
  });

  it("treats doc as an extension hint without polluting the query", () => {
    const parsed = parseFileRequest("Share latest API design doc");

    expect(parsed.exactFilename).toBeNull();
    expect(parsed.extensions).toContain(".doc");
    expect(parsed.cleanQuery).toBe("latest api design");
  });

  it("exposes a class wrapper for parser consumers", () => {
    const parsed = new FileRequestParser().parse("Send me Job Offer-Associate Consultant.pdf file");

    expect(parsed.exactFilename).toBe("Job Offer-Associate Consultant.pdf");
    expect(parsed.confidenceReason).toBe("filename");
  });
});
