import { localAgentClient } from "./localAgentClient";
import type { UniversalSearchResult, UniversalSearchResultType } from "./types";

export const searchApi = {
  universal: (query: string, options: { types?: UniversalSearchResultType[]; limit?: number } = {}) => {
    const params = new URLSearchParams();
    params.set("q", query);
    if (options.types?.length) params.set("types", options.types.join(","));
    if (options.limit) params.set("limit", String(options.limit));
    return localAgentClient.get<{ query: string; results: UniversalSearchResult[] }>(`/search/universal?${params}`);
  }
};
