import { getLlmProvider, type LlmProvider } from "../oci/LlmProvider.js";
import { LlmVoiceCommandParser } from "./LlmVoiceCommandParser.js";
import { RuleBasedVoiceCommandParser } from "./VoiceCommandParser.js";
import { VoiceCommandParseResultSchema, type VoiceCommandParseResult } from "./VoiceCommandTypes.js";

const RULE_CONFIDENCE_THRESHOLD = 0.72;

export class CommandUnderstandingService {
  private readonly ruleParser = new RuleBasedVoiceCommandParser();
  private readonly llmParser: LlmVoiceCommandParser;

  constructor(llm: LlmProvider = getLlmProvider()) {
    this.llmParser = new LlmVoiceCommandParser(llm);
  }

  async parse(transcript: string): Promise<VoiceCommandParseResult> {
    const ruleResult = VoiceCommandParseResultSchema.parse(this.ruleParser.parse(transcript));
    if (ruleResult.confidence >= RULE_CONFIDENCE_THRESHOLD && ruleResult.intent !== "unknown") {
      return ruleResult;
    }

    const llmResult = await this.llmParser.parse(transcript);
    if (llmResult.intent !== "unknown" && llmResult.confidence > ruleResult.confidence) {
      return llmResult;
    }
    return ruleResult.intent === "unknown" ? llmResult : ruleResult;
  }
}
