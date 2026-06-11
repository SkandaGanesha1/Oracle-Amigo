import { createHash, randomUUID } from "node:crypto";
import { dirname, extname, join } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import type { StoredFile } from "../storage/AgenticStorage.js";

export interface WatermarkSpec {
  recipientLabel: string;
  text?: string;
}

export interface RedactionMark {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  reason?: string;
}

export interface RedactionPreview {
  fileId: string;
  fileName: string;
  supported: boolean;
  pageCount: number;
  watermarkText: string;
  redactionCount: number;
}

export interface RedactionJob {
  id: string;
  sourceFileId: string;
  fileName: string;
  sha256: string;
  downloadUrl: string;
  watermarkText: string;
  createdAt: string;
}

export class RedactionEngine {
  constructor(private readonly db: DatabaseSync) {}

  async preview(file: StoredFile, watermark: WatermarkSpec, redactions: RedactionMark[] = []): Promise<RedactionPreview> {
    const bytes = readFileSync(file.storedPath);
    const supported = isPdf(file.originalFileName, bytes);
    const pageCount = supported ? (await PDFDocument.load(bytes)).getPageCount() : 0;
    return {
      fileId: file.id,
      fileName: file.originalFileName,
      supported,
      pageCount,
      watermarkText: watermarkText(watermark),
      redactionCount: redactions.length
    };
  }

  async apply(file: StoredFile, watermark: WatermarkSpec, redactions: RedactionMark[] = []): Promise<RedactionJob> {
    const bytes = readFileSync(file.storedPath);
    if (!isPdf(file.originalFileName, bytes)) {
      throw new Error("Only PDF redaction and watermarking is supported in this release.");
    }
    const pdf = await PDFDocument.load(bytes);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const pages = pdf.getPages();
    const markColor = rgb(0.02, 0.02, 0.02);
    const wm = watermarkText(watermark);

    for (const mark of redactions) {
      const page = pages[mark.page - 1];
      if (!page) continue;
      page.drawRectangle({
        x: mark.x,
        y: mark.y,
        width: Math.max(1, mark.width),
        height: Math.max(1, mark.height),
        color: markColor
      });
    }

    for (const page of pages) {
      const { width } = page.getSize();
      page.drawText(wm, {
        x: 32,
        y: 24,
        size: 8,
        font,
        color: rgb(0.35, 0.35, 0.35),
        maxWidth: width - 64
      });
    }

    const output = Buffer.from(await pdf.save());
    const id = `red_${randomUUID()}`;
    const sha256 = createHash("sha256").update(output).digest("hex");
    const outputPath = join(dirname(file.storedPath), `${id}${extname(file.originalFileName) || ".pdf"}`);
    writeFileSync(outputPath, output);
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO redaction_audit (id, source_file_id, output_path, output_sha256, redactions_json, watermark_text, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, file.id, outputPath, sha256, JSON.stringify(redactions), wm, now);

    this.db.prepare(`
      INSERT INTO watermark_history (id, redaction_id, recipient_label, watermark_text, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(`wm_${randomUUID()}`, id, watermark.recipientLabel, wm, now);

    return {
      id,
      sourceFileId: file.id,
      fileName: file.originalFileName.replace(/\.pdf$/i, "") + ".redacted.pdf",
      sha256,
      downloadUrl: `/redactions/${encodeURIComponent(id)}/download`,
      watermarkText: wm,
      createdAt: now
    };
  }

  getOutput(redactionId: string): { path: string; fileName: string; sha256: string } | null {
    const row = this.db.prepare("SELECT * FROM redaction_audit WHERE id = ?").get(redactionId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      path: String(row.output_path),
      fileName: `${redactionId}.pdf`,
      sha256: String(row.output_sha256)
    };
  }
}

function isPdf(fileName: string, bytes: Buffer): boolean {
  return /\.pdf$/i.test(fileName) || bytes.subarray(0, 4).toString("utf8") === "%PDF";
}

function watermarkText(spec: WatermarkSpec): string {
  return spec.text?.trim() || `Sent to ${spec.recipientLabel || "recipient"} by Oracle Amigo on ${new Date().toISOString().slice(0, 10)}`;
}
