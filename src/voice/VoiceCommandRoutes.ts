import type { FastifyInstance, FastifyReply } from "fastify";
import { z, ZodError } from "zod";
import { VoiceCommandRequestSchema } from "./VoiceCommandTypes.js";
import { VoiceCommandError, VoiceCommandService } from "./VoiceCommandService.js";

const CommandIdParamsSchema = z.object({
  id: z.string().trim().min(1)
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

  server.post("/voice/commands", async (request, reply) => {
    try {
      const body = VoiceCommandRequestSchema.parse(request.body ?? {});
      const command = await service.createCommand(body);
      return { command };
    } catch (err) {
      return sendVoiceError(reply, err);
    }
  });

  server.get("/voice/commands/:id", async (request, reply) => {
    const { id } = CommandIdParamsSchema.parse(request.params);
    const command = service.getCommand(id);
    if (!command) return reply.status(404).send({ error: "VOICE_COMMAND_NOT_FOUND", message: "Voice command not found" });
    return { command };
  });

  server.post("/voice/commands/:id/confirm", async (request, reply) => {
    try {
      const { id } = CommandIdParamsSchema.parse(request.params);
      const command = await service.confirmCommand(id);
      return { command };
    } catch (err) {
      return sendVoiceError(reply, err);
    }
  });

  server.post("/voice/commands/:id/cancel", async (request, reply) => {
    try {
      const { id } = CommandIdParamsSchema.parse(request.params);
      const command = service.cancelCommand(id);
      return { command };
    } catch (err) {
      return sendVoiceError(reply, err);
    }
  });
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
