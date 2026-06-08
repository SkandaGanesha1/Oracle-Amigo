import type { StoredFile } from "./types";
import { localAgentClient } from "./localAgentClient";

export const filesApi = {
  receivedFiles: () => localAgentClient.get<{ files: StoredFile[] }>("/storage/files")
};
