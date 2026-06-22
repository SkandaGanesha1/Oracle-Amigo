import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, extname, join, resolve, sep } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { PDFDocument } from "pdf-lib";
import type { ChatMessageRecord } from "../chat/ChatRepository.js";
import { ChatRepository } from "../chat/ChatRepository.js";
import { getDb } from "../db/connection.js";
import { getStoredFile, storageRoot, type StoredFile } from "../storage/AgenticStorage.js";
import { PopplerPdfRenderer } from "./PopplerPdfRenderer.js";
import { signedStorageUrl } from "./FileUrlSigner.js";

export type FilePreviewStatus = "processing" | "ready" | "failed" | "blocked";

export interface FilePreviewRecord {
  fileId: string;
  status: FilePreviewStatus;
  sourceMimeType: string;
  pageCount: number | null;
  thumb360Path: string | null;
  thumb720Path: string | null;
  width: number | null;
  height: number | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FilePreviewMetadata {
  status: FilePreviewStatus;
  page_count: number | null;
  width: number | null;
  height: number | null;
  error_message?: string | null;
  thumbnail_variants: Array<"360" | "720">;
}

const PDF_HEADER = Buffer.from("%PDF-");
const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;

export class FilePreviewService {
  private readonly queue = new Set<string>();
  private running = false;

  constructor(
    private readonly db: DatabaseSync = getDb(),
    private readonly renderer: PopplerPdfRenderer = new PopplerPdfRenderer(),
    private readonly chatRepo = new ChatRepository(db)
  ) {}

  getPreview(fileId: string): FilePreviewRecord | null {
    const row = this.db.prepare("SELECT * FROM file_previews WHERE file_id = ?").get(fileId) as Record<string, unknown> | undefined;
    return row ? rowToPreview(row) : null;
  }

  ensurePreview(fileId: string): FilePreviewRecord | null {
    const stored = getStoredFile(fileId);
    if (!stored) return null;
    const existing = this.getPreview(fileId);
    if (existing?.status === "ready" || existing?.status === "processing" || existing?.status === "blocked" || existing?.status === "failed") {
      return existing;
    }
    const preview = this.upsertPreview(fileId, {
      status: "processing",
      sourceMimeType: "application/pdf",
      errorMessage: null
    });
    this.enqueue(fileId);
    return preview;
  }

  signedThumbnailUrl(fileId: string, variant: "360" | "720"): string {
    return signedStorageUrl({ fileId, kind: "thumbnail", variant }, 10 * 60);
  }

  signedViewerUrl(fileId: string): string {
    return signedStorageUrl({ fileId, kind: "view" }, 5 * 60);
  }

  enqueue(fileId: string): void {
    this.queue.add(fileId);
    void this.drain();
  }

  enqueueMessageAttachments(message: ChatMessageRecord): void {
    const attachments = Array.isArray(message.payload_json.attachments) ? message.payload_json.attachments : [];
    for (const raw of attachments) {
      const attachment = raw as Record<string, unknown>;
      if (!isPdfAttachment(attachment)) continue;
      const fileId = attachmentFileId(attachment);
      if (fileId) this.ensurePreview(fileId);
    }
  }

  async generate(fileId: string): Promise<FilePreviewRecord | null> {
    const stored = getStoredFile(fileId);
    if (!stored) return null;
    try {
      validateStoredPdf(stored);
      const bytes = readFileSync(stored.storedPath);
      const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
      const previewDir = join(storageRoot(), "previews", stored.id);
      mkdirSync(previewDir, { recursive: true });
      const thumb360Path = join(previewDir, "thumb_360.webp");
      const thumb720Path = join(previewDir, "thumb_720.webp");
      const rendered = await this.renderer.renderFirstPage(stored.storedPath, { thumb360Path, thumb720Path });
      const preview = this.upsertPreview(fileId, {
        status: "ready",
        sourceMimeType: "application/pdf",
        pageCount: doc.getPageCount(),
        thumb360Path,
        thumb720Path,
        width: rendered.width,
        height: rendered.height,
        errorMessage: null
      });
      this.applyPreviewToChatMessages(fileId, preview);
      return preview;
    } catch (err) {
      const message = err instanceof Error ? err.message : "PDF preview generation failed";
      const status: FilePreviewStatus = message.includes("blocked") ? "blocked" : "failed";
      const preview = this.upsertPreview(fileId, {
        status,
        sourceMimeType: "application/pdf",
        errorMessage: message
      });
      this.applyPreviewToChatMessages(fileId, preview);
      return preview;
    }
  }

  applyPreviewToChatMessages(fileId: string, preview: FilePreviewRecord): void {
    const rows = this.db.prepare(`
      SELECT * FROM chat_messages
      WHERE payload_json LIKE ?
      ORDER BY created_at DESC
      LIMIT 500
    `).all(`%${fileId}%`) as Array<Record<string, unknown>>;
    for (const row of rows) {
      const message = rowToMessage(row);
      const attachments = Array.isArray(message.payload_json.attachments) ? message.payload_json.attachments : null;
      if (!attachments) continue;
      let changed = false;
      const nextAttachments = attachments.map((raw) => {
        const attachment = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
        if (attachmentFileId(attachment) !== fileId) return raw;
        changed = true;
        return {
          ...attachment,
          preview_status: preview.status,
          page_count: preview.pageCount,
          width: preview.width,
          height: preview.height,
          preview_error: preview.errorMessage,
          thumbnail_variants: preview.status === "ready" ? ["360", "720"] : []
        };
      });
      if (changed) this.chatRepo.updateMessagePayload(message.id, { attachments: nextAttachments });
    }
  }

  toMetadata(preview: FilePreviewRecord | null): FilePreviewMetadata {
    if (!preview) {
      return { status: "processing", page_count: null, width: null, height: null, thumbnail_variants: [] };
    }
    return {
      status: preview.status,
      page_count: preview.pageCount,
      width: preview.width,
      height: preview.height,
      error_message: preview.errorMessage,
      thumbnail_variants: preview.status === "ready" ? ["360", "720"] : []
    };
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.size > 0) {
        const [fileId] = this.queue;
        this.queue.delete(fileId);
        await this.generate(fileId);
      }
    } finally {
      this.running = false;
    }
  }

  private upsertPreview(fileId: string, input: {
    status: FilePreviewStatus;
    sourceMimeType: string;
    pageCount?: number | null;
    thumb360Path?: string | null;
    thumb720Path?: string | null;
    width?: number | null;
    height?: number | null;
    errorMessage?: string | null;
  }): FilePreviewRecord {
    const now = new Date().toISOString();
    const existing = this.getPreview(fileId);
    this.db.prepare(`
      INSERT INTO file_previews
        (file_id, status, source_mime_type, page_count, thumb_360_path, thumb_720_path, width, height, error_message, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(file_id) DO UPDATE SET
        status=excluded.status,
        source_mime_type=excluded.source_mime_type,
        page_count=COALESCE(excluded.page_count, file_previews.page_count),
        thumb_360_path=COALESCE(excluded.thumb_360_path, file_previews.thumb_360_path),
        thumb_720_path=COALESCE(excluded.thumb_720_path, file_previews.thumb_720_path),
        width=COALESCE(excluded.width, file_previews.width),
        height=COALESCE(excluded.height, file_previews.height),
        error_message=excluded.error_message,
        updated_at=excluded.updated_at
    `).run(
      fileId,
      input.status,
      input.sourceMimeType,
      input.pageCount ?? null,
      input.thumb360Path ?? null,
      input.thumb720Path ?? null,
      input.width ?? null,
      input.height ?? null,
      input.errorMessage ?? null,
      existing?.createdAt ?? now,
      now
    );
    return this.getPreview(fileId)!;
  }
}

export function getPreviewThumbnailPath(preview: FilePreviewRecord, variant: "360" | "720"): string | null {
  return variant === "360" ? preview.thumb360Path : preview.thumb720Path;
}

export function validateStoredPdf(stored: StoredFile): void {
  if (!existsSync(stored.storedPath)) throw new Error("File not found on disk");
  const maxBytes = Number(process.env.PDF_PREVIEW_MAX_BYTES ?? DEFAULT_MAX_BYTES);
  const stat = statSync(stored.storedPath);
  if (stat.size > maxBytes) throw new Error(`PDF preview blocked: file exceeds ${maxBytes} bytes`);
  if (extname(stored.originalFileName).toLowerCase() !== ".pdf") throw new Error("PDF preview blocked: file extension is not .pdf");
  const resolvedRoot = ensureTrailingSep(realpathSync(storageRoot()));
  const resolvedFile = realpathSync(stored.storedPath);
  if (!resolvedFile.startsWith(resolvedRoot)) throw new Error("PDF preview blocked: file is outside local storage");
  const header = readFileSync(stored.storedPath, { encoding: null }).subarray(0, PDF_HEADER.length);
  if (!header.equals(PDF_HEADER)) throw new Error("PDF preview blocked: file signature is not PDF");
  const actualHash = createHash("sha256").update(readFileSync(stored.storedPath)).digest("hex");
  if (actualHash !== stored.sha256) throw new Error("PDF preview blocked: stored hash mismatch");
}

export function isPdfAttachment(attachment: Record<string, unknown>): boolean {
  const type = String(attachment.mime_type ?? attachment.mimeType ?? "").toLowerCase();
  const name = String(attachment.file_name ?? attachment.fileName ?? "");
  return type === "application/pdf" || name.toLowerCase().endsWith(".pdf");
}

export function attachmentFileId(attachment: Record<string, unknown>): string | null {
  for (const key of ["file_id", "fileId", "stored_file_id", "storedFileId", "id"]) {
    const value = attachment[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  const url = typeof attachment.url === "string" ? attachment.url : typeof attachment.thumbnail_url === "string" ? attachment.thumbnail_url : "";
  const match = url.match(/\/storage\/files\/([^/]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

function rowToPreview(row: Record<string, unknown>): FilePreviewRecord {
  return {
    fileId: String(row.file_id),
    status: normalizeStatus(String(row.status ?? "failed")),
    sourceMimeType: String(row.source_mime_type ?? "application/octet-stream"),
    pageCount: nullableNumber(row.page_count),
    thumb360Path: nullableString(row.thumb_360_path),
    thumb720Path: nullableString(row.thumb_720_path),
    width: nullableNumber(row.width),
    height: nullableNumber(row.height),
    errorMessage: nullableString(row.error_message),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function rowToMessage(row: Record<string, unknown>): ChatMessageRecord {
  return {
    id: String(row.id),
    conversation_id: String(row.conversation_id),
    task_id: nullableString(row.task_id),
    sender_user_id: nullableString(row.sender_user_id),
    sender_agent_instance_id: nullableString(row.sender_agent_instance_id),
    receiver_agent_instance_id: nullableString(row.receiver_agent_instance_id),
    message_type: String(row.message_type) as ChatMessageRecord["message_type"],
    text: nullableString(row.text),
    payload_json: parsePayload(row.payload_json),
    delivery_status: String(row.delivery_status ?? "local_pending") as ChatMessageRecord["delivery_status"],
    created_at: String(row.created_at),
    updated_at: String(row.updated_at)
  };
}

function parsePayload(value: unknown): Record<string, unknown> {
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function normalizeStatus(value: string): FilePreviewStatus {
  return value === "processing" || value === "ready" || value === "failed" || value === "blocked" ? value : "failed";
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function nullableNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function ensureTrailingSep(path: string): string {
  const resolved = resolve(path);
  return resolved.endsWith(sep) ? resolved : `${resolved}${sep}`;
}
