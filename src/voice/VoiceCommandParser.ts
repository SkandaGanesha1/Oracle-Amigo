import type { VoiceCommandParseResult } from "./VoiceCommandTypes.js";

const EXTENSION_HINTS = new Map([
  ["pdf", "pdf"],
  ["doc", "doc"],
  ["docx", "docx"],
  ["ppt", "ppt"],
  ["pptx", "pptx"],
  ["xls", "xls"],
  ["xlsx", "xlsx"],
  ["csv", "csv"],
  ["txt", "txt"],
  ["md", "md"],
  ["png", "png"],
  ["jpg", "jpg"],
  ["jpeg", "jpeg"],
  ["mp4", "mp4"],
  ["zip", "zip"],
  ["py", "py"],
  ["ts", "ts"]
]);

const TRAILING_REQUEST_WORDS = /\s+(?:file|document|please)$/i;

export class RuleBasedVoiceCommandParser {
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
        schemaVersion: "voice-command.v1",
        intent: "find_file",
        ...cleanFileRequest(findMatch[1]),
        confidence: 0.86,
        requiresConfirmation: false,
        requesterReference: "current_user",
        missingFields: [],
        originalTranscript,
        parserProvider: "rule"
      };
    }

    if (/^show\s+(?:my\s+)?pending\s+approvals$/i.test(text)) {
      return {
        schemaVersion: "voice-command.v1",
        intent: "show_approvals",
        confidence: 0.96,
        requiresConfirmation: false,
        fileExtensions: [],
        requesterReference: "current_user",
        missingFields: [],
        originalTranscript,
        parserProvider: "rule"
      };
    }

    if (/^open\s+(?:my\s+)?inbox$/i.test(text)) {
      return {
        schemaVersion: "voice-command.v1",
        intent: "open_inbox",
        confidence: 0.96,
        requiresConfirmation: false,
        fileExtensions: [],
        requesterReference: "current_user",
        missingFields: [],
        originalTranscript,
        parserProvider: "rule"
      };
    }

    const openChatMatch = text.match(/^open\s+chat\s+with\s+(.+?)$/i);
    if (openChatMatch) {
      return {
        schemaVersion: "voice-command.v1",
        intent: "open_chat",
        targetPersonQuery: cleanPersonQuery(openChatMatch[1]),
        confidence: 0.9,
        requiresConfirmation: false,
        fileExtensions: [],
        requesterReference: "current_user",
        missingFields: [],
        originalTranscript,
        parserProvider: "rule"
      };
    }

    const receivedFilesMatch = text.match(/^show\s+files\s+received\s+from\s+(.+?)$/i);
    if (receivedFilesMatch) {
      return {
        schemaVersion: "voice-command.v1",
        intent: "show_files_received",
        targetPersonQuery: cleanPersonQuery(receivedFilesMatch[1]),
        confidence: 0.88,
        requiresConfirmation: false,
        fileExtensions: [],
        requesterReference: "current_user",
        missingFields: [],
        originalTranscript,
        parserProvider: "rule"
      };
    }

    return {
      schemaVersion: "voice-command.v1",
      intent: "unknown",
      confidence: 0.1,
      requiresConfirmation: true,
      fileExtensions: [],
      requesterReference: "current_user",
      missingFields: ["intent"],
      originalTranscript,
      parserProvider: "rule",
      error: "I could not confidently map that to a supported Oracle Amigo command."
    };
  }
}

export class VoiceCommandParser extends RuleBasedVoiceCommandParser {}

export function parseVoiceCommand(transcript: string): VoiceCommandParseResult {
  return new RuleBasedVoiceCommandParser().parse(transcript);
}

function remoteFileRequest(originalTranscript: string, person: string, file: string, confidence: number): VoiceCommandParseResult {
  const targetPersonQuery = cleanPersonQuery(person);
  const cleaned = cleanFileRequest(file);
  const missingFields = [
    targetPersonQuery ? null : "target_person_query",
    cleaned.fileQuery ? null : "file_query"
  ].filter((field): field is string => Boolean(field));
  return {
    schemaVersion: "voice-command.v1",
    intent: targetPersonQuery && cleaned.fileQuery ? "remote_file_request" : "unknown",
    targetPersonQuery: targetPersonQuery || undefined,
    ...cleaned,
    fileQuery: cleaned.fileQuery || undefined,
    confidence: targetPersonQuery && cleaned.fileQuery ? confidence : 0.35,
    requiresConfirmation: true,
    requesterReference: "current_user",
    missingFields,
    parserProvider: "rule",
    originalTranscript,
    error: targetPersonQuery && cleaned.fileQuery ? undefined : "A remote file request needs both a person and a file."
  };
}

function cleanFileRequest(value: string): { fileQuery: string; fileExtensions: string[] } {
  const stripped = stripOuterPunctuation(normalizeWhitespace(value))
    .replace(TRAILING_REQUEST_WORDS, "")
    .trim();
  const extensions = new Set<string>();
  let query = stripped.replace(/\b([a-z0-9_-]+)\.(pdf|docx?|pptx?|xlsx?|csv|txt|md|png|jpe?g|mp4|zip|py|ts)\b/gi, (_match, name: string, ext: string) => {
    extensions.add(normalizeExtension(ext));
    return `${name}.${normalizeExtension(ext)}`;
  });
  query = query.replace(/\b(pdf|docx?|pptx?|xlsx?|csv|txt|md|png|jpe?g|mp4|zip|py|ts)\b/gi, (_match, ext: string) => {
    extensions.add(normalizeExtension(ext));
    return "";
  });
  query = stripOuterPunctuation(normalizeWhitespace(query));
  if (extensions.size === 1 && query && !/\.[a-z0-9]{1,8}$/i.test(query)) {
    query = `${query}.${Array.from(extensions)[0]}`;
  }
  return { fileQuery: query, fileExtensions: Array.from(extensions) };
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

function normalizeExtension(value: string): string {
  const normalized = value.toLowerCase() === "jpeg" ? "jpg" : value.toLowerCase();
  return EXTENSION_HINTS.get(normalized) ?? normalized;
}
