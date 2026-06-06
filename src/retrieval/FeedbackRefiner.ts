import type { SearchOptions } from "./HybridRetrievalPipeline.js";
import { RuleBasedIntentExtractor } from "../intent/IntentExtractor.js";

const extractor = new RuleBasedIntentExtractor();

export type FeedbackResult = {
  newQuery: string;
  searchOptions: SearchOptions;
};

export function refine(originalQuery: string, feedbackText: string, rejectedFileIds: number[]): FeedbackResult {
  const intent = extractor.extract(feedbackText);
  // Merge terms: feedback words not in original query
  const origWords = new Set(originalQuery.toLowerCase().split(/\s+/));
  const newTerms = feedbackText.toLowerCase().split(/\s+/).filter((w) => w.length > 2 && !origWords.has(w));
  const newQuery = newTerms.length > 0 ? `${feedbackText.trim()}` : originalQuery;

  return {
    newQuery,
    searchOptions: {
      extensions: intent.extensions.length > 0 ? intent.extensions : undefined,
      excludeIds: [...rejectedFileIds],
    },
  };
}
