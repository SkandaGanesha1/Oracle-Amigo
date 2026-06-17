import type { LlmProvider } from "../oci/LlmProvider.js";
import { HybridVoiceCommandParser } from "./HybridVoiceCommandParser.js";
import type { VoiceCommandParseResult } from "./VoiceCommandTypes.js";
import type { VoiceCommandParser, VoiceCommandParserInput } from "./VoiceCommandParserInterface.js";

export class CommandUnderstandingService implements VoiceCommandParser {
  private readonly parser: HybridVoiceCommandParser;

  constructor(llm?: LlmProvider) {
    this.parser = llm ? new HybridVoiceCommandParser(llm) : new HybridVoiceCommandParser();
  }

  async parse(input: string | VoiceCommandParserInput): Promise<VoiceCommandParseResult> {
    return this.parser.parse(typeof input === "string" ? {
      transcript: input,
      currentUser: null
    } : input);
  }
}
