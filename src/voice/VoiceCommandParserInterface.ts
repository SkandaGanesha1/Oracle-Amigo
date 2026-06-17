import type { VoiceCommandParseResult } from "./VoiceCommandTypes.js";

export interface VoiceCommandParserInput {
  transcript: string;
  locale?: string | null;
  currentUser: {
    userId: string;
    displayName?: string | null;
    email?: string | null;
  } | null;
  knownContacts?: Array<{
    userId: string;
    displayName?: string | null;
    email?: string | null;
  }>;
}

export interface VoiceCommandParser {
  parse(input: VoiceCommandParserInput): Promise<VoiceCommandParseResult>;
}
