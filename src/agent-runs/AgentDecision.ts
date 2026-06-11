import { z } from "zod";
import type { FileSearchResult } from "../file-search/FileSearchService.js";

export const AgentDecisionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("execute_command"),
    reason: z.string().min(1),
    tool: z.enum(["host-file-search", "gondolin-vm-command"]),
    command: z.string().min(1),
    cwd: z.string().optional(),
    timeoutMs: z.number().int().positive().optional()
  }),
  z.object({
    type: z.literal("semantic_search"),
    reason: z.string().min(1),
    query: z.string().min(1),
    roots: z.array(z.string()).optional(),
    fileTypes: z.array(z.string()).optional()
  }),
  z.object({
    type: z.literal("final_answer"),
    reason: z.string().min(1),
    status: z.enum(["found", "not_found", "need_help"]),
    message: z.string().min(1),
    selectedFileId: z.preprocess((value) => value === null ? undefined : value, z.string().optional())
  })
]);

export type AgentDecision = z.infer<typeof AgentDecisionSchema>;

export type AgentObservation = {
  iteration: number;
  decision: AgentDecision;
  status: "completed" | "failed" | "blocked";
  summary: string;
  stdout?: string;
  stderr?: string;
};

export type AgentReasoningContext = {
  runId: string;
  query: string;
  searchedRoots: string[];
  sandboxSessionId: string | null;
  iterations: AgentObservation[];
  fileSearch: FileSearchResult | null;
};

export interface AgentReasoner {
  reasonNextAction(context: AgentReasoningContext): Promise<AgentDecision>;
}

export class HeuristicAgentReasoner implements AgentReasoner {
  async reasonNextAction(context: AgentReasoningContext): Promise<AgentDecision> {
    if (!context.fileSearch) {
      return {
        type: "semantic_search",
        reason: "Start with semantic filename and path matching across the configured local roots.",
        query: context.query
      };
    }

    if (context.fileSearch.selectedMatch) {
      return {
        type: "final_answer",
        reason: "A ranked local file match was found.",
        status: "found",
        message: `Found ${context.fileSearch.selectedMatch.fileName}.`,
        selectedFileId: context.fileSearch.selectedMatch.id
      };
    }

    if (!context.iterations.some((iteration) => iteration.decision.type === "execute_command")) {
      return {
        type: "execute_command",
        reason: "Confirm the current working directory with a safe read-only terminal command before ending the search.",
        tool: "host-file-search",
        command: "Get-Location"
      };
    }

    return {
      type: "final_answer",
      reason: "The configured local roots were searched and no ranked match was found.",
      status: "not_found",
      message: `No matching file was found in: ${context.searchedRoots.join(", ")}`
    };
  }
}
