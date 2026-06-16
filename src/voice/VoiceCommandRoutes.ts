import type { FastifyInstance, FastifyReply } from "fastify";
import { z, ZodError } from "zod";
import {
  VoiceCommandConfirmRequestSchema,
  VoiceCommandRequestSchema,
  VoiceTranscribeRequestSchema,
  type VoiceCommandRecord,
  type VoiceTranscribeRequest
} from "./VoiceCommandTypes.js";
import { VoiceCommandError, VoiceCommandService } from "./VoiceCommandService.js";

const CommandIdParamsSchema = z.object({
  id: z.string().trim().min(1)
});

const VoiceCommandListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(10_000).default(0)
});

export function registerVoiceCommandRoutes(
  server: FastifyInstance,
  service: VoiceCommandService,
  getStatus: () => Record<string, unknown>
): void {
  server.get("/voice/status", async () => ({
    ok: true,
    localAgent: "online",
    ...getStatus()
  }));

  server.post("/voice/transcribe", async (request, reply) => {
    try {
      const body = VoiceTranscribeRequestSchema.parse(request.body ?? {});
      return await transcribeVoiceAudio(body, reply);
    } catch (err) {
      return sendVoiceError(reply, err);
    }
  });

  server.post("/voice/commands", async (request, reply) => {
    try {
      const body = VoiceCommandRequestSchema.parse(request.body ?? {});
      const command = await service.createCommand(body);
      return voiceCommandResponse(command);
    } catch (err) {
      return sendVoiceError(reply, err);
    }
  });

  server.get("/voice/commands", async (request, reply) => {
    try {
      const query = VoiceCommandListQuerySchema.parse(request.query ?? {});
      const commands = service.listCommands(query);
      return {
        commands,
        pageInfo: {
          offset: query.offset,
          limit: query.limit,
          hasMore: commands.length === query.limit
        }
      };
    } catch (err) {
      return sendVoiceError(reply, err);
    }
  });

  server.get("/voice/commands/:id", async (request, reply) => {
    const { id } = CommandIdParamsSchema.parse(request.params);
    const command = service.getCommand(id);
    if (!command) return reply.status(404).send({ error: "VOICE_COMMAND_NOT_FOUND", message: "Voice command not found" });
    return voiceCommandResponse(command);
  });

  server.get("/voice/commands/:id/events", async (request, reply) => {
    const { id } = CommandIdParamsSchema.parse(request.params);
    const command = service.getCommand(id);
    if (!command) return reply.status(404).send({ error: "VOICE_COMMAND_NOT_FOUND", message: "Voice command not found" });
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive"
    });
    for (const event of service.listEvents(id)) {
      writeSse(reply.raw, event.eventType, event);
    }
    const unsubscribe = service.subscribe(id, (event) => writeSse(reply.raw, event.eventType, event));
    request.raw.on("close", unsubscribe);
  });

  server.post("/voice/commands/:id/confirm", async (request, reply) => {
    try {
      const { id } = CommandIdParamsSchema.parse(request.params);
      const body = VoiceCommandConfirmRequestSchema.parse(request.body ?? {});
      const command = await service.confirmCommand(id, body);
      return voiceCommandResponse(command);
    } catch (err) {
      return sendVoiceError(reply, err);
    }
  });

  server.post("/voice/commands/:id/cancel", async (request, reply) => {
    try {
      const { id } = CommandIdParamsSchema.parse(request.params);
      const command = service.cancelCommand(id);
      return voiceCommandResponse(command);
    } catch (err) {
      return sendVoiceError(reply, err);
    }
  });
}

async function transcribeVoiceAudio(body: VoiceTranscribeRequest, reply: FastifyReply): Promise<unknown> {
  const providerUrl = process.env.ORACLE_AMIGO_TRANSCRIBE_URL?.trim();
  if (!providerUrl) {
    return reply.status(501).send({
      error: "VOICE_TRANSCRIBER_UNAVAILABLE",
      message: "No local speech-to-text provider is configured for /voice/transcribe."
    });
  }

  const response = await fetch(providerUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      audioBase64: body.audioBase64,
      locale: body.locale,
      mimeType: body.mimeType,
      source: body.source
    })
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = isRecord(payload) && typeof payload.message === "string"
      ? payload.message
      : "Speech-to-text provider failed.";
    return reply.status(response.status).send({ error: "VOICE_TRANSCRIPTION_FAILED", message });
  }
  if (!isRecord(payload) || typeof payload.transcript !== "string" || !payload.transcript.trim()) {
    return reply.status(502).send({
      error: "VOICE_TRANSCRIPTION_FAILED",
      message: "Speech-to-text provider returned no transcript."
    });
  }
  return {
    confidence: typeof payload.confidence === "number" ? payload.confidence : undefined,
    provider: typeof payload.provider === "string" ? payload.provider : "local",
    transcript: payload.transcript.trim()
  };
}

function sendVoiceError(reply: FastifyReply, err: unknown): void {
  if (err instanceof ZodError) {
    reply.status(400).send({ error: "INVALID_VOICE_COMMAND", message: err.issues[0]?.message ?? "Invalid voice command" });
    return;
  }
  if (err instanceof VoiceCommandError) {
    reply.status(err.code === "VOICE_COMMAND_NOT_FOUND" ? 404 : 409).send({ error: err.code, message: err.message });
    return;
  }
  const message = err instanceof Error ? err.message : String(err);
  reply.status(500).send({ error: "VOICE_COMMAND_FAILED", message });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function voiceCommandResponse(command: VoiceCommandRecord): Record<string, unknown> {
  return {
    command,
    command_id: command.id,
    status: command.status,
    parsed: command.parsed,
    preview: command.preview,
    mission_id: command.missionId,
    conversation_id: command.conversationId,
    relay_task_id: command.relayTaskId,
    message: command.status === "submitted" ? "File request sent to the remote agent." : undefined
  };
}

function writeSse(raw: NodeJS.WritableStream, event: string, data: unknown): void {
  raw.write(`event: ${event}\n`);
  raw.write(`data: ${JSON.stringify(data)}\n\n`);
}
