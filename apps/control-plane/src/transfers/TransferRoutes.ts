import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { requireDeviceAuth } from "./../auth/AuthMiddleware.js";
import {
  downloadTransfer, initTransfer, recordTransferReceipt, uploadTransfer
} from "./TransferService.js";

const InitSchema = z.object({
  to_agent_instance_id: z.string().min(1),
  file_name: z.string().min(1).max(255),
  file_size: z.number().int().min(1).max(1073741824),
  sha256: z.string().regex(/^[a-fA-F0-9]{64}$/),
  relay_task_id: z.string().min(1).max(120).optional()
});

const ReceiptSchema = z.object({
  stored_path: z.string().min(1).max(2048),
  verified_sha256: z.string().regex(/^[a-fA-F0-9]{64}$/)
});

export async function registerTransferRoutes(app: FastifyInstance, publicBaseUrl: string): Promise<void> {
  app.post("/v1/transfers/init", { preHandler: requireDeviceAuth() }, async (req, reply) => {
    if (!req.deviceContext) {
      reply.code(401).send({ error: "UNAUTHORIZED" });
      return;
    }
    try {
      const body = InitSchema.parse(req.body);
      const result = await initTransfer({
        orgId: req.deviceContext.orgId,
        fromAgentInstanceId: req.deviceContext.agentInstanceId,
        toAgentInstanceId: body.to_agent_instance_id as never,
        fileName: body.file_name,
        fileSize: body.file_size,
        sha256: body.sha256,
        relayTaskId: body.relay_task_id
      }, publicBaseUrl);
      reply.send(result);
    } catch (err) {
      if (err instanceof ZodError) {
        reply.code(400).send({ error: "VALIDATION_ERROR", issues: err.issues });
        return;
      }
      reply.code(400).send({ error: "TRANSFER_INIT_FAILED", message: err instanceof Error ? err.message : String(err) });
    }
  });

  app.put("/v1/transfers/:transfer_id/upload", { preHandler: requireDeviceAuth() }, async (req, reply) => {
    if (!req.deviceContext) {
      reply.code(401).send({ error: "UNAUTHORIZED" });
      return;
    }
    const { transfer_id } = req.params as { transfer_id: string };
    try {
      const body = req.body;
      let data: Buffer;
      if (Buffer.isBuffer(body)) {
        data = body;
      } else if (typeof body === "string") {
        data = Buffer.from(body, "utf8");
      } else if (body instanceof Uint8Array) {
        data = Buffer.from(body);
      } else {
        data = Buffer.alloc(0);
      }
      const result = await uploadTransfer(
        req.deviceContext.orgId,
        transfer_id,
        req.deviceContext.agentInstanceId,
        data
      );
      reply.send(result);
    } catch (err) {
      reply.code(400).send({ error: "TRANSFER_UPLOAD_FAILED", message: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get("/v1/transfers/:transfer_id/download", { preHandler: requireDeviceAuth() }, async (req, reply) => {
    if (!req.deviceContext) {
      reply.code(401).send({ error: "UNAUTHORIZED" });
      return;
    }
    const { transfer_id } = req.params as { transfer_id: string };
    try {
      const { data, fileName, sha256, fileSize } = await downloadTransfer(
        req.deviceContext.orgId,
        transfer_id,
        req.deviceContext.agentInstanceId
      );
      reply.header("content-type", "application/octet-stream");
      reply.header("content-disposition", `attachment; filename="${encodeURIComponent(fileName)}"`);
      reply.header("x-content-sha256", sha256);
      reply.header("x-content-length", String(fileSize));
      reply.send(data);
    } catch (err) {
      reply.code(400).send({ error: "TRANSFER_DOWNLOAD_FAILED", message: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post("/v1/transfers/:transfer_id/receipt", { preHandler: requireDeviceAuth() }, async (req, reply) => {
    if (!req.deviceContext) {
      reply.code(401).send({ error: "UNAUTHORIZED" });
      return;
    }
    const { transfer_id } = req.params as { transfer_id: string };
    try {
      const body = ReceiptSchema.parse(req.body);
      const result = await recordTransferReceipt(
        req.deviceContext.orgId,
        transfer_id,
        req.deviceContext.agentInstanceId,
        { stored_path: body.stored_path, verified_sha256: body.verified_sha256 }
      );
      reply.send(result);
    } catch (err) {
      if (err instanceof ZodError) {
        reply.code(400).send({ error: "VALIDATION_ERROR", issues: err.issues });
        return;
      }
      reply.code(400).send({ error: "TRANSFER_RECEIPT_FAILED", message: err instanceof Error ? err.message : String(err) });
    }
  });
}
