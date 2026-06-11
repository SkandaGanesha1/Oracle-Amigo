import type { IntentClassification, QueryRewriteResult } from "./types";
import { localAgentClient } from "./localAgentClient";

export const intentApi = {
  classify: (text: string) =>
    localAgentClient.post<{ classification: IntentClassification }>("/intent/classify", { text }),
  rewrite: (query: string) =>
    localAgentClient.post<{ rewrite: QueryRewriteResult }>("/intent/rewrite", { query }),
};
