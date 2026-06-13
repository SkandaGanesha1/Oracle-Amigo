import { describe, expect, it } from "vitest";
import { parseVoiceCommand } from "../src/voice/VoiceCommandParser.js";

describe("voice command parser", () => {
  it("extracts a remote file request target and filename", () => {
    const parsed = parseVoiceCommand("Ask Docin to send me NonPO invoice india.pdf file");

    expect(parsed.intent).toBe("remote_file_request");
    expect(parsed.targetPersonQuery).toBe("Docin");
    expect(parsed.fileQuery).toBe("NonPO invoice india.pdf");
    expect(parsed.requiresConfirmation).toBe(true);
    expect(parsed.confidence).toBeGreaterThan(0.9);
  });

  it("extracts the requested Harassment Certification file command", () => {
    const parsed = parseVoiceCommand("Ask Docin to send Harassment Certification.pdf file");

    expect(parsed.intent).toBe("remote_file_request");
    expect(parsed.targetPersonQuery).toBe("Docin");
    expect(parsed.fileQuery).toBe("Harassment Certification.pdf");
    expect(parsed.confidence).toBeGreaterThan(0.9);
  });

  it("recognizes alternate remote file request phrasings", () => {
    expect(parseVoiceCommand("Request NonPO invoice india.pdf from Docin").intent).toBe("remote_file_request");
    expect(parseVoiceCommand("Send a file request to Docin for NonPO invoice india.pdf").intent).toBe("remote_file_request");
  });

  it("parses local and navigation commands", () => {
    expect(parseVoiceCommand("Find Job Offer-Associate Consultant.pdf on my device").intent).toBe("find_file");
    expect(parseVoiceCommand("Show pending approvals").intent).toBe("show_approvals");
    expect(parseVoiceCommand("Open my inbox").intent).toBe("open_inbox");
    expect(parseVoiceCommand("Open chat with Docin").targetPersonQuery).toBe("Docin");
    expect(parseVoiceCommand("Show files received from Docin").intent).toBe("show_files_received");
  });

  it("keeps ambiguous commands out of execution", () => {
    const parsed = parseVoiceCommand("please handle the thing");

    expect(parsed.intent).toBe("unknown");
    expect(parsed.requiresConfirmation).toBe(true);
    expect(parsed.error).toContain("supported Oracle Amigo command");
  });
});
