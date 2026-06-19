/**
 * ReceiverApprovalRoutes
 *
 * Fastify routes for the receiver-side approval workflow.
 * These power the approval cards in the Chat UI when an incoming
 * voice-triggered file request needs the receiver's decision.
 *
 * Endpoints:
 *   GET  /receiver/approvals               — list all approvals (supports ?status=pending)
 *   GET  /receiver/approvals/:id           — get a specific approval
 *   POST /receiver/approvals/:id/approve   — receiver approves with a selected file
 *   POST /receiver/approvals/:id/reject    — receiver rejects the request
 */
import type { FastifyInstance, FastifyReply, RouteShorthandOptions } from "fastify";
import { z, ZodError } from "zod";
import { ReceiverAgentOrchestrator, ReceiverApprovalError } from "./ReceiverAgentOrchestrator.js";
import { ApprovalTransferOrchestrator } from "./ApprovalTransferOrchestrator.js";
import type { DatabaseSync } from "node:sqlite";

const ApprovalIdParamsSchema = z.object({
  id: z.string().trim().min(1)
});

const ApprovalListQuerySchema = z.object({
  status: z.enum(["pending", "approved", "rejected", "transferred", "failed"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50)
});

const ApproveBodySchema = z.object({
  selected_file_path: z.string().trim().min(1, "selected_file_path is required"),
  idempotency_key: z.string().trim().min(1).max(200).optional()
});

const RejectBodySchema = z.object({
  reason: z.string().trim().max(500).optional()
});

export function registerReceiverApprovalRoutes(
  server: FastifyInstance,
  db: DatabaseSync,
  routeOptions: RouteShorthandOptions = {}
): void {
  const orchestrator = new ReceiverAgentOrchestrator(db);
  const transferOrchestrator = new ApprovalTransferOrchestrator(db);

  // GET /receiver/approvals — list approvals, optionally filtered by status
  server.get("/receiver/approvals", routeOptions, async (request, reply) => {
    try {
      const query = ApprovalListQuerySchema.parse(request.query ?? {});
      const approvals = orchestrator.listApprovals({ limit: query.limit, status: query.status });
      return {
        approvals,
        count: approvals.length,
        pending: approvals.filter((a) => a.status === "pending").length
      };
    } catch (err) {
      return sendApprovalError(reply, err);
    }
  });

  // GET /receiver/approvals/:id — get one approval
  server.get("/receiver/approvals/:id", routeOptions, async (request, reply) => {
    try {
      const { id } = ApprovalIdParamsSchema.parse(request.params);
      const approval = orchestrator.getApproval(id);
      if (!approval) {
        return reply.status(404).send({ error: "APPROVAL_NOT_FOUND", message: "Approval not found" });
      }
      return { approval };
    } catch (err) {
      return sendApprovalError(reply, err);
    }
  });

  // POST /receiver/approvals/:id/approve — receiver approves the transfer
  server.post("/receiver/approvals/:id/approve", routeOptions, async (request, reply) => {
    try {
      const { id } = ApprovalIdParamsSchema.parse(request.params);
      const body = ApproveBodySchema.parse(request.body ?? {});
      const approval = orchestrator.approveTransfer(id, body.selected_file_path);

      // Kick off the actual file upload in the background (non-blocking)
      // The ApprovalTransferOrchestrator handles: hash → init → upload → relay notify
      setImmediate(() => {
        void kickOffTransfer(orchestrator, transferOrchestrator, approval.id, body.selected_file_path);
      });

      return {
        approval,
        message: "Approval recorded. File transfer is being initiated."
      };
    } catch (err) {
      return sendApprovalError(reply, err);
    }
  });

  // POST /receiver/approvals/:id/reject — receiver rejects the transfer
  server.post("/receiver/approvals/:id/reject", routeOptions, async (request, reply) => {
    try {
      const { id } = ApprovalIdParamsSchema.parse(request.params);
      const body = RejectBodySchema.parse(request.body ?? {});
      const approval = orchestrator.rejectTransfer(id, body.reason);
      return { approval, message: "Request rejected." };
    } catch (err) {
      return sendApprovalError(reply, err);
    }
  });
}

/**
 * Kicks off the file upload + relay notification after approval.
 * Runs non-blocking so the API returns immediately.
 */
async function kickOffTransfer(
  orchestrator: ReceiverAgentOrchestrator,
  transferOrchestrator: ApprovalTransferOrchestrator,
  approvalId: string,
  _selectedFilePath: string
): Promise<void> {
  try {
    console.info(`[ReceiverApproval] Transfer initiated for approval ${approvalId}`);
    const approval = orchestrator.getApproval(approvalId);
    if (!approval) {
      throw new Error(`Approval ${approvalId} not found in database`);
    }

    await transferOrchestrator.transferReceiverApproval(approval);
    orchestrator.markTransferred(approvalId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[ReceiverApproval] Transfer failed for approval ${approvalId}:`, message);
    try {
      orchestrator.markFailed(approvalId, message);
    } catch (markErr) {
      const markMessage = markErr instanceof Error ? markErr.message : String(markErr);
      console.error(`[ReceiverApproval] Failed to record transfer failure for approval ${approvalId}:`, markMessage);
    }
  }
}

function sendApprovalError(reply: FastifyReply, err: unknown): void {
  if (err instanceof ZodError) {
    reply.status(400).send({
      error: "INVALID_APPROVAL_REQUEST",
      message: err.issues[0]?.message ?? "Invalid request"
    });
    return;
  }
  if (err instanceof ReceiverApprovalError) {
    const statusCode = err.code === "APPROVAL_NOT_FOUND" ? 404 : 409;
    reply.status(statusCode).send({ error: err.code, message: err.message });
    return;
  }
  const message = err instanceof Error ? err.message : String(err);
  reply.status(500).send({ error: "RECEIVER_APPROVAL_FAILED", message });
}
