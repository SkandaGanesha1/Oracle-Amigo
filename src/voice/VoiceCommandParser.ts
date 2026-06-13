import type { VoiceCommandParseResult } from "./VoiceCommandTypes.js";

const TRAILING_REQUEST_WORDS = /\s+(?:file|document|pdf|please)$/i;

export class VoiceCommandParser {
  parse(transcript: string): VoiceCommandParseResult {
    const originalTranscript = transcript.trim();
    const text = normalizeWhitespace(originalTranscript);

    const askMatch = text.match(/^(?:ask|tell)\s+(.+?)\s+to\s+send(?:\s+me)?\s+(.+?)$/i);
    if (askMatch) return remoteFileRequest(originalTranscript, askMatch[1], askMatch[2], 0.94);

    const requestMatch = text.match(/^request\s+(.+?)\s+from\s+(.+?)$/i);
    if (requestMatch) return remoteFileRequest(originalTranscript, requestMatch[2], requestMatch[1], 0.92);

    const sendRequestMatch = text.match(/^send\s+(?:a\s+)?file\s+request\s+to\s+(.+?)\s+for\s+(.+?)$/i);
    if (sendRequestMatch) return remoteFileRequest(originalTranscript, sendRequestMatch[1], sendRequestMatch[2], 0.92);

    const findMatch = text.match(/^(?:find|search(?:\s+for)?)\s+(.+?)(?:\s+on\s+my\s+device)?$/i);
    if (findMatch) {
      return {
        intent: "find_file",
        fileQuery: cleanFileQuery(findMatch[1]),
        confidence: 0.86,
        requiresConfirmation: false,
        originalTranscript
      };
    }

    if (/^show\s+(?:my\s+)?pending\s+approvals$/i.test(text)) {
      return {
        intent: "show_approvals",
        confidence: 0.96,
        requiresConfirmation: false,
        originalTranscript
      };
    }

    if (/^open\s+(?:my\s+)?inbox$/i.test(text)) {
      return {
        intent: "open_inbox",
        confidence: 0.96,
        requiresConfirmation: false,
        originalTranscript
      };
    }

    const openChatMatch = text.match(/^open\s+chat\s+with\s+(.+?)$/i);
    if (openChatMatch) {
      return {
        intent: "open_chat",
        targetPersonQuery: cleanPersonQuery(openChatMatch[1]),
        confidence: 0.9,
        requiresConfirmation: false,
        originalTranscript
      };
    }

    const receivedFilesMatch = text.match(/^show\s+files\s+received\s+from\s+(.+?)$/i);
    if (receivedFilesMatch) {
      return {
        intent: "show_files_received",
        targetPersonQuery: cleanPersonQuery(receivedFilesMatch[1]),
        confidence: 0.88,
        requiresConfirmation: false,
        originalTranscript
      };
    }

    return {
      intent: "unknown",
      confidence: 0.1,
      requiresConfirmation: true,
      originalTranscript,
      error: "I could not confidently map that to a supported Oracle Amigo command."
    };
  }
}

export function parseVoiceCommand(transcript: string): VoiceCommandParseResult {
  return new VoiceCommandParser().parse(transcript);
}

function remoteFileRequest(originalTranscript: string, person: string, file: string, confidence: number): VoiceCommandParseResult {
  const targetPersonQuery = cleanPersonQuery(person);
  const fileQuery = cleanFileQuery(file);
  return {
    intent: targetPersonQuery && fileQuery ? "remote_file_request" : "unknown",
    targetPersonQuery: targetPersonQuery || undefined,
    fileQuery: fileQuery || undefined,
    confidence: targetPersonQuery && fileQuery ? confidence : 0.35,
    requiresConfirmation: true,
    originalTranscript,
    error: targetPersonQuery && fileQuery ? undefined : "A remote file request needs both a person and a file."
  };
}

function cleanFileQuery(value: string): string {
  return stripOuterPunctuation(normalizeWhitespace(value))
    .replace(TRAILING_REQUEST_WORDS, "")
    .trim();
}

function cleanPersonQuery(value: string): string {
  return stripOuterPunctuation(normalizeWhitespace(value))
    .replace(/\s+(?:please)$/i, "")
    .trim();
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function stripOuterPunctuation(value: string): string {
  return value.replace(/^[\s"'`]+|[\s"'`.,!?;:]+$/g, "");
}
