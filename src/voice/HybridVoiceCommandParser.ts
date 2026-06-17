import { getLlmProvider, type LlmProvider } from "../oci/LlmProvider.js";
import { LlmVoiceCommandParser } from "./LlmVoiceCommandParser.js";
import { RuleBasedVoiceCommandParser } from "./RuleBasedVoiceCommandParser.js";
import { VoiceCommandParseResultSchema, type VoiceCommandParseResult } from "./VoiceCommandTypes.js";
import type { VoiceCommandParser, VoiceCommandParserInput } from "./VoiceCommandParserInterface.js";

const DEFAULT_RULE_CONFIDENCE_THRESHOLD = 0.72;

export class HybridVoiceCommandParser implements VoiceCommandParser {
  private readonly ruleParser = new RuleBasedVoiceCommandParser();
  private readonly llmParser: LlmVoiceCommandParser;

  constructor(
    llm: LlmProvider = getLlmProvider(),
    private readonly ruleConfidenceThreshold = Number(process.env.VOICE_LLM_RULE_CONFIDENCE_THRESHOLD ?? DEFAULT_RULE_CONFIDENCE_THRESHOLD)
  ) {
    this.llmParser = new LlmVoiceCommandParser(llm);
  }

  async parse(input: VoiceCommandParserInput): Promise<VoiceCommandParseResult> {
    const transcript = input.transcript;
    const ruleResult = VoiceCommandParseResultSchema.parse(this.ruleParser.parse(transcript));

    // If rule-based parser is highly confident, skip LLM call to save latency/cost
    if (ruleResult.confidence >= this.ruleConfidenceThreshold && ruleResult.intent !== "unknown") {
      return ruleResult;
    }

    // Pass the full input (including currentUser) to the LLM parser for better context
    const llmResult = await this.llmParser.parse(input);
    if (llmResult.intent !== "unknown" && llmResult.confidence > ruleResult.confidence) {
      return llmResult;
    }
    return ruleResult.intent === "unknown" ? llmResult : ruleResult;
  }
}
