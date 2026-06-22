import { describe, expect, it } from "vitest";
import { VoiceCommandRequestSchema, VoiceTranscribeRequestSchema } from "../src/voice/VoiceCommandTypes.js";

describe("voice command schemas", () => {
  it("accepts chat-composer as a voice command source", () => {
    const result = VoiceCommandRequestSchema.parse({
      transcript: "Ask Docin to send the invoice",
      source: "chat-composer",
      input_mode: "speech"
    });

    expect(result.source).toBe("chat-composer");
  });

  it("accepts chat-composer as a transcription source", () => {
    const result = VoiceTranscribeRequestSchema.parse({
      audioBase64: "dm9pY2U=",
      mimeType: "audio/webm",
      source: "chat-composer"
    });

    expect(result.source).toBe("chat-composer");
  });
});
