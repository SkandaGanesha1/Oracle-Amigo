import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetDb, getDb } from "../src/db/connection.js";
import { VoiceCommandService } from "../src/voice/VoiceCommandService.js";
import { HybridVoiceCommandParser } from "../src/voice/HybridVoiceCommandParser.js";
import type { LocalCloudIdentity } from "../src/cloud/LocalCloudIdentityStore.js";
import type { LlmProvider, LlmStructuredRequest } from "../src/oci/LlmProvider.js";

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "voice-command-"));
  process.env.AGENTIC_DB_PATH = join(tmpRoot, "agent.db");
  _resetDb();
});

afterEach(() => {
  _resetDb();
  delete process.env.AGENTIC_DB_PATH;
  try { rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe("voice command service", () => {
  it("creates a safe preview and confirms through the relay file-request executor", async () => {
    const executeRemoteFileRequest = vi.fn(async () => ({
      status: "submitted" as const,
      conversationId: "conv_1",
      relayTaskId: "relay_1"
    }));
    const service = new VoiceCommandService({
      db: getDb(),
      getCloudIdentity: () => cloudIdentity(),
      resolveUser: async (query) => query === "Docin"
        ? { userId: "usr_docin", displayName: "Docin", email: "docin@example.com" }
        : null,
      executeRemoteFileRequest
    });

    const command = await service.createCommand({
      transcript: "Ask Docin to send me NonPO invoice india.pdf file",
      source: "voice-launcher",
      mode: "preview_then_execute"
    });

    expect(command.status).toBe("preview_required");
    expect(command.preview.title).toContain("Docin");
    expect(command.preview.dataMovementNote).toContain("remote user must approve");

    const confirmed = await service.confirmCommand(command.id);
    expect(confirmed.status).toBe("submitted");
    expect(confirmed.completedAt).toBeNull();
    expect(confirmed.relayTaskId).toBe("relay_1");
    expect(executeRemoteFileRequest).toHaveBeenCalledWith(expect.objectContaining({
      targetUserId: "usr_docin",
      fileQuery: "NonPO invoice india.pdf",
      idempotencyKey: `voice-${command.id}`
    }));
  });

  it("does not execute ambiguous or missing-target commands", async () => {
    const executeRemoteFileRequest = vi.fn();
    const service = new VoiceCommandService({
      db: getDb(),
      getCloudIdentity: () => cloudIdentity(),
      resolveUser: async () => null,
      executeRemoteFileRequest
    });

    const command = await service.createCommand({
      transcript: "Ask Unknown Person to send me NonPO invoice india.pdf file",
      source: "voice-launcher",
      mode: "preview_then_execute"
    });

    expect(command.status).toBe("failed");
    expect(command.errorMessage).toContain("could not find");
    await expect(service.confirmCommand(command.id)).rejects.toThrow(/could not find/i);
    expect(executeRemoteFileRequest).not.toHaveBeenCalled();
  });

  it("cancels before execution", async () => {
    const executeRemoteFileRequest = vi.fn();
    const service = new VoiceCommandService({
      db: getDb(),
      getCloudIdentity: () => cloudIdentity(),
      resolveUser: async () => ({ userId: "usr_docin", displayName: "Docin", email: null }),
      executeRemoteFileRequest
    });
    const command = await service.createCommand({
      transcript: "Request NonPO invoice india.pdf from Docin",
      source: "voice-launcher",
      mode: "preview_then_execute"
    });

    const cancelled = service.cancelCommand(command.id);
    expect(cancelled.status).toBe("cancelled");
    await expect(service.confirmCommand(command.id)).rejects.toThrow(/cancelled/i);
    expect(executeRemoteFileRequest).not.toHaveBeenCalled();
  });

  it("redacts unsafe local paths from stored transcript and error text", async () => {
    const service = new VoiceCommandService({
      db: getDb(),
      getCloudIdentity: () => cloudIdentity(),
      resolveUser: async () => null,
      executeRemoteFileRequest: vi.fn()
    });

    const command = await service.createCommand({
      transcript: "Find C:\\Users\\Skanda\\Secrets\\token.txt on my device",
      source: "voice-launcher",
      mode: "preview_then_execute"
    });

    expect(command.transcript).toContain("Local path hidden");
    expect(command.transcript).not.toContain("Secrets");
  });

  it("uses validated LLM fallback for low-confidence voice commands", async () => {
    const llm = new FakeVoiceLlmProvider({
      schema_version: "voice-command.v1",
      intent: "remote_file_request",
      requester_reference: "current_user",
      target_person_query: "Docin",
      file_query: "Harassment Certificate",
      file_extensions: ["pdf"],
      confidence: 0.93,
      requires_confirmation: true,
      missing_fields: [],
      original_transcript: "Please get that harassment certificate from Docin"
    });
    const service = new VoiceCommandService({
      db: getDb(),
      parser: new HybridVoiceCommandParser(llm, 0.99),
      getCloudIdentity: () => cloudIdentity(),
      resolveUser: async (query) => query === "Docin"
        ? { userId: "usr_docin", displayName: "Docin", email: "docin@example.com" }
        : null,
      executeRemoteFileRequest: vi.fn()
    });

    const command = await service.createCommand({
      transcript: "Please get that harassment certificate from Docin",
      source: "voice-launcher",
      mode: "preview_then_execute"
    });

    expect(command.parsed.parserProvider).toBe("llm");
    expect(command.parsed.requesterReference).toBe("current_user");
    expect(command.parsed.targetPersonQuery).toBe("Docin");
    expect(command.parsed.fileQuery).toBe("Harassment Certificate");
    expect(command.parsed.fileExtensions).toEqual(["pdf"]);
  });
});

class FakeVoiceLlmProvider implements LlmProvider {
  constructor(private readonly output: unknown) {}
  isAvailable(): boolean { return true; }
  async generateStructured<T>(request: LlmStructuredRequest<T>): Promise<T> {
    return request.schema.parse(this.output);
  }
  async generateEmbeddings(): Promise<Float32Array[]> {
    return [];
  }
}

function cloudIdentity(): LocalCloudIdentity {
  return {
    profileId: "default",
    controlPlaneUrl: "http://127.0.0.1:8080",
    orgId: "org_1",
    userId: "usr_skanda",
    userEmail: "skanda@example.com",
    displayName: "Skanda",
    deviceId: "dev_1",
    agentId: "ag_1",
    agentInstanceId: "agi_1",
    relayInboxUrl: null,
    userAccessToken: "user-token",
    deviceAccessToken: "device-token",
    refreshToken: null,
    userRefreshToken: null,
    deviceRefreshToken: null,
    status: "enrolled",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}
