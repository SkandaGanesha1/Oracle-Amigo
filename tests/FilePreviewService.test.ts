import { createHash } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ChatRepository } from "../src/chat/ChatRepository.js";
import { _resetDb, getDb } from "../src/db/connection.js";
import { FilePreviewService, validateStoredPdf } from "../src/files/FilePreviewService.js";
import { signFileRoute, verifyFileRoute } from "../src/files/FileUrlSigner.js";
import { storeReceivedRelayFile } from "../src/storage/AgenticStorage.js";

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), "file-preview-"));
  process.env.AGENTIC_DB_PATH = join(tmpRoot, "agent.db");
  process.env.AGENTIC_STORAGE_ROOT = join(tmpRoot, "storage");
  process.env.FILE_PREVIEW_SIGNING_SECRET = "test-preview-secret-test-preview-secret";
  _resetDb();
});

afterEach(() => {
  _resetDb();
  delete process.env.AGENTIC_DB_PATH;
  delete process.env.AGENTIC_STORAGE_ROOT;
  delete process.env.FILE_PREVIEW_SIGNING_SECRET;
  rmSync(tmpRoot, { recursive: true, force: true });
});

async function makePdf(): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([300, 200]);
  page.drawText("Preview fixture");
  return Buffer.from(await pdf.save());
}

describe("file preview signing", () => {
  it("accepts valid signatures and rejects tampered signatures", () => {
    const expires = Math.floor(Date.now() / 1000) + 60;
    const sig = signFileRoute({ fileId: "file-1", kind: "thumbnail", variant: "360", expires });
    expect(verifyFileRoute({ fileId: "file-1", kind: "thumbnail", variant: "360", expires }, sig)).toBe(true);
    expect(verifyFileRoute({ fileId: "file-1", kind: "thumbnail", variant: "720", expires }, sig)).toBe(false);
  });

  it("rejects expired signatures", () => {
    const expires = Math.floor(Date.now() / 1000) - 1;
    const sig = signFileRoute({ fileId: "file-1", kind: "view", expires });
    expect(verifyFileRoute({ fileId: "file-1", kind: "view", expires }, sig)).toBe(false);
  });
});

describe("FilePreviewService", () => {
  it("validates PDF signature and stored hash", async () => {
    const data = await makePdf();
    const stored = storeReceivedRelayFile({
      transferId: "transfer-1",
      senderAgentId: "sender",
      fileName: "fixture.pdf",
      data,
      sha256: createHash("sha256").update(data).digest("hex")
    });

    expect(() => validateStoredPdf(stored)).not.toThrow();
  });

  it("rejects non-PDF bytes", () => {
    const data = Buffer.from("not a pdf");
    const stored = storeReceivedRelayFile({
      transferId: "transfer-2",
      senderAgentId: "sender",
      fileName: "fixture.pdf",
      data,
      sha256: createHash("sha256").update(data).digest("hex")
    });

    expect(() => validateStoredPdf(stored)).toThrow(/signature is not PDF/);
  });

  it("records ready preview metadata with a fake renderer", async () => {
    const data = await makePdf();
    const stored = storeReceivedRelayFile({
      transferId: "transfer-3",
      senderAgentId: "sender",
      fileName: "fixture.pdf",
      data,
      sha256: createHash("sha256").update(data).digest("hex")
    });
    const renderer = {
      async renderFirstPage(_input: string, output: { thumb360Path: string; thumb720Path: string }) {
        mkdirSync(dirname(output.thumb360Path), { recursive: true });
        writeFileSync(output.thumb360Path, "webp360");
        writeFileSync(output.thumb720Path, "webp720");
        return { width: 300, height: 200 };
      }
    };
    const service = new FilePreviewService(getDb(), renderer as never, new ChatRepository(getDb()));

    const preview = await service.generate(stored.id);

    expect(preview).toMatchObject({
      fileId: stored.id,
      status: "ready",
      pageCount: 1,
      width: 300,
      height: 200
    });
    expect(service.toMetadata(preview).thumbnail_variants).toEqual(["360", "720"]);
  });
});
