export type VoiceLauncherState =
  | "hidden"
  | "opening"
  | "listening"
  | "transcribing"
  | "sending"
  | "completed"
  | "failed";

export interface VoiceCommandPreview {
  commandId: string;
  intent: string;
  title: string;
  targetUser?: { userId: string; displayName: string | null; email: string | null };
  fileQuery?: string;
  dataMovementNote?: string;
  actionLabel: string;
  requiresConfirmation: boolean;
  error?: string;
}

export interface VoiceCommandRecord {
  id: string;
  transcript: string;
  status: string;
  parsed: { confidence: number };
  preview: VoiceCommandPreview;
  conversationId: string | null;
  relayTaskId: string | null;
  errorMessage: string | null;
}

export interface VoiceTranscriptionResult {
  confidence?: number;
  provider: string;
  transcript: string;
}

const DEFAULT_AGENT_URL = "http://127.0.0.1:3399";

export class LocalAgentVoiceClient {
  constructor(private baseUrl = agentUrl()) {}

  async status(): Promise<Record<string, unknown>> {
    return this.request("/voice/status");
  }

  async isLocalAgentReachable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/cloud/status`);
      return response.status < 500;
    } catch {
      return false;
    }
  }

  async createCommand(transcript: string, sttConfidence?: number): Promise<VoiceCommandRecord> {
    const response = await this.request<{ command: VoiceCommandRecord }>("/voice/commands", {
      method: "POST",
      body: JSON.stringify({
        transcript,
        source: "voice-launcher",
        mode: "auto_execute",
        sttConfidence
      })
    });
    return response.command;
  }

  async autoSendTranscript(
    transcript: string,
    options: { locale?: string; sttConfidence?: number } = {}
  ): Promise<VoiceCommandRecord> {
    const command = await this.createCommandWithOptions(transcript, {
      mode: "auto_execute",
      locale: options.locale,
      sttConfidence: options.sttConfidence
    });
    if (command.preview?.error) throw new Error(command.preview.error);
    return this.confirmCommand(command.id);
  }

  async transcribeAudio(audio: Blob, options: { locale?: string } = {}): Promise<VoiceTranscriptionResult> {
    const audioBase64 = await blobToBase64(audio);
    return this.request<VoiceTranscriptionResult>("/voice/transcribe", {
      method: "POST",
      body: JSON.stringify({
        audioBase64,
        locale: options.locale,
        mimeType: audio.type || "application/octet-stream",
        source: "voice-launcher"
      })
    });
  }

  private async createCommandWithOptions(
    transcript: string,
    options: { mode: "preview_then_execute" | "auto_execute"; locale?: string; sttConfidence?: number }
  ): Promise<VoiceCommandRecord> {
    const response = await this.request<{ command: VoiceCommandRecord }>("/voice/commands", {
      method: "POST",
      body: JSON.stringify({
        transcript,
        source: "voice-launcher",
        mode: options.mode,
        locale: options.locale,
        sttConfidence: options.sttConfidence
      })
    });
    return response.command;
  }

  async confirmCommand(commandId: string): Promise<VoiceCommandRecord> {
    const response = await this.request<{ command: VoiceCommandRecord }>(`/voice/commands/${encodeURIComponent(commandId)}/confirm`, {
      method: "POST"
    });
    return response.command;
  }

  async cancelCommand(commandId: string): Promise<VoiceCommandRecord> {
    const response = await this.request<{ command: VoiceCommandRecord }>(`/voice/commands/${encodeURIComponent(commandId)}/cancel`, {
      method: "POST"
    });
    return response.command;
  }

  private async request<T = Record<string, unknown>>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
    const response = await fetch(`${this.baseUrl}${path}`, { ...init, headers });
    const contentType = response.headers.get("content-type") ?? "";
    const text = await response.text();
    if (path.startsWith("/voice/") && (!contentType.includes("application/json") || looksLikeHtml(text))) {
      throw new LocalAgentRequestError(
        "A local agent is running, but it does not expose the Quick Voice API.",
        404
      );
    }
    let payload: unknown = {};
    try {
      payload = text ? JSON.parse(text) as unknown : {};
    } catch {
      throw new LocalAgentRequestError("Local agent returned an unreadable response.", response.status);
    }
    if (!response.ok) {
      const errorPayload = isRecord(payload) ? payload : {};
      const message = typeof errorPayload.message === "string" ? errorPayload.message : undefined;
      const error = typeof errorPayload.error === "string" ? errorPayload.error : undefined;
      throw new LocalAgentRequestError(message || error || `Local agent request failed with ${response.status}`, response.status);
    }
    return payload as T;
  }
}

export class LocalAgentRequestError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
  }
}

export function agentUrl(): string {
  const envUrl = import.meta.env.VITE_ORACLE_AMIGO_LOCAL_AGENT_URL || import.meta.env.ORACLE_AMIGO_LOCAL_AGENT_URL;
  return String(envUrl || DEFAULT_AGENT_URL).replace(/\/+$/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function looksLikeHtml(value: string): boolean {
  return /^\s*<!doctype html/i.test(value) || /^\s*<html[\s>]/i.test(value);
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}
