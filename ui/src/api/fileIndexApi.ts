import type { FileSearchResult, IndexedFile, TransferRecord } from "./types";
import { localAgentClient } from "./localAgentClient";

function params(values: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const raw = search.toString();
  return raw ? `?${raw}` : "";
}

export const fileIndexApi = {
  roots: () => localAgentClient.get<{ roots: string[] }>("/files/index-roots"),
  indexRoots: (roots: string[]) =>
    localAgentClient.post<{ ok: boolean; roots: Array<{ root: string; indexed: number }> }>("/files/index-roots", { roots }),
  reindex: (roots: string[]) =>
    localAgentClient.post<{ ok: boolean; message: string; roots: Array<{ root: string; indexed: number }> }>("/files/reindex", { roots }),
  search: (query: string) =>
    localAgentClient.post<FileSearchResult[]>("/files/search", { query }),
  indexed: (limit = 100, offset = 0) =>
    localAgentClient.get<{ items: IndexedFile[]; total: number; limit: number; offset: number }>(
      `/files/indexed${params({ limit, offset })}`
    ),
  transfers: () => localAgentClient.get<{ transfers: TransferRecord[] }>("/transfers"),
  // Vault folder management
  getRoots: () => localAgentClient.get<{ roots: Array<{ id: number; rootPath: string; displayName: string; enabled: boolean; lastIndexedAt: string | null; fileCount: number; createdAt: string; updatedAt: string }> }>("/files/roots"),
  addRoot: (rootPath: string, displayName?: string) =>
    localAgentClient.post<{ ok: boolean; root: { id: number; rootPath: string; displayName: string; enabled: boolean; lastIndexedAt: string | null; fileCount: number; createdAt: string; updatedAt: string } }>("/files/roots", { rootPath, displayName }),
  removeRoot: (id: number) => localAgentClient.delete<{ ok: boolean }>(`/files/roots/${id}`),
  getExcludes: (rootPath?: string) =>
    localAgentClient.get<{ excludes: Array<{ id: number; rootPath: string; excludePath: string; excludeType: string; createdAt: string }> }>(`/files/excludes${params({ rootPath })}`),
  addExclude: (rootPath: string, excludePath: string, excludeType?: "folder" | "pattern") =>
    localAgentClient.post<{ ok: boolean; exclude: { id: number; rootPath: string; excludePath: string; excludeType: string; createdAt: string } }>("/files/excludes", { rootPath, excludePath, excludeType }),
  removeExclude: (id: number) => localAgentClient.delete<{ ok: boolean }>(`/files/excludes/${id}`),
};
