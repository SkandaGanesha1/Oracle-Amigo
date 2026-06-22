import type { StoredFile } from "./types";
import { localAgentClient } from "./localAgentClient";

export interface PdfPreviewMetadata {
  status: "processing" | "ready" | "failed" | "blocked";
  page_count: number | null;
  width: number | null;
  height: number | null;
  error_message?: string | null;
  thumbnail_variants: Array<"360" | "720">;
}

export const filesApi = {
  receivedFiles: () => localAgentClient.get<{ files: StoredFile[] }>("/storage/files"),
  openUrl: (fileId: string) => `/storage/files/${encodeURIComponent(fileId)}/open`,
  downloadUrl: (fileId: string) => `/storage/files/${encodeURIComponent(fileId)}/download`,
  preview: (fileId: string) =>
    localAgentClient.get<{ id: string; preview: PdfPreviewMetadata }>(`/storage/files/${encodeURIComponent(fileId)}/preview`),
  thumbnailUrl: (fileId: string, variant: "360" | "720" = "360") =>
    localAgentClient.get<{ id: string; variant: "360" | "720"; preview: PdfPreviewMetadata; url: string | null }>(
      `/storage/files/${encodeURIComponent(fileId)}/thumbnail-url?variant=${encodeURIComponent(variant)}`
    ),
  viewerUrl: (fileId: string) =>
    localAgentClient.get<{ id: string; preview: PdfPreviewMetadata; url: string | null }>(`/storage/files/${encodeURIComponent(fileId)}/viewer-url`),
  verifyFile: (fileId: string) =>
    localAgentClient.get<{
      id: string;
      sha256: string;
      expected_sha256: string;
      hash_verified: boolean;
      size_bytes: number;
    }>(`/storage/files/${encodeURIComponent(fileId)}/verify`)
};
