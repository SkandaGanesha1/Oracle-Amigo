import type { StoredFile } from "./types";
import { localAgentClient } from "./localAgentClient";

export const filesApi = {
  receivedFiles: () => localAgentClient.get<{ files: StoredFile[] }>("/storage/files"),
  verifyFile: (fileId: string) =>
    localAgentClient.get<{
      id: string;
      sha256: string;
      expected_sha256: string;
      hash_verified: boolean;
      size_bytes: number;
    }>(`/storage/files/${encodeURIComponent(fileId)}/verify`)
};
