import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseSync } from "node:sqlite";

const tmpDb = join(tmpdir(), `test-workflow-${Date.now()}.db`);
const tmpKeys = join(tmpdir(), `test-wf-keys-${Date.now()}`);

describe("WorkflowStateMachine", () => {
  beforeEach(() => {
    vi.stubEnv("AGENTIC_DB_PATH", tmpDb);
    vi.stubEnv("LOCALAPPDATA", tmpKeys);
  });

  afterEach(async () => {
    const { _resetDb } = await import("../src/db/connection.js");
    _resetDb();
    vi.unstubAllEnvs();
    try { rmSync(tmpDb); } catch { /* ignore */ }
    try { rmSync(tmpKeys, { recursive: true }); } catch { /* ignore */ }
  });

  it("A2A_STATE_MAP covers every InternalState without undefined", async () => {
    const { A2A_STATE_MAP, VALID_TRANSITIONS } = await import("../src/workflow/WorkflowStates.js");
    for (const state of VALID_TRANSITIONS.keys()) {
      expect(A2A_STATE_MAP[state], `A2A_STATE_MAP missing: ${state}`).toBeDefined();
    }
  });

  it("valid transition REQUEST_RECEIVED → INTENT_CLASSIFIED succeeds", async () => {
    const { createTask, transition, getTask } = await import("../src/workflow/TaskWorkflow.js");
    const task = createTask({ actorAgentId: "agent-a" });
    expect(task.protocolState).toBe("REQUEST_RECEIVED");
    const updated = transition(task.id, "INTENT_CLASSIFIED", {}, "agent-a");
    expect(updated.protocolState).toBe("INTENT_CLASSIFIED");
    expect(updated.status).toBe("working");
    expect(getTask(task.id)?.protocolState).toBe("INTENT_CLASSIFIED");
  });

  it("invalid transition throws InvalidTransitionError and writes audit event", async () => {
    const { createTask, transition } = await import("../src/workflow/TaskWorkflow.js");
    const { InvalidTransitionError } = await import("../src/workflow/WorkflowStates.js");
    const { getEvents } = await import("../src/security/AuditHashChain.js");

    const task = createTask({ actorAgentId: "agent-a" });
    expect(() => transition(task.id, "COMPLETED")).toThrow(InvalidTransitionError);

    const events = getEvents();
    expect(events.some((e) => e.eventType === "INVALID_TRANSITION")).toBe(true);
  });

  it("REJECTED state maps to 'rejected' A2A status", async () => {
    const { createTask, transition } = await import("../src/workflow/TaskWorkflow.js");
    const task = createTask({});
    transition(task.id, "INTENT_CLASSIFIED");
    transition(task.id, "SEARCH_QUERY_BUILT");
    transition(task.id, "LOCAL_SEARCH_RUNNING");
    transition(task.id, "CANDIDATES_RANKED");
    transition(task.id, "APPROVAL_REQUIRED");
    const rejected = transition(task.id, "REJECTED");
    expect(rejected.status).toBe("rejected");
    expect(rejected.completedAt).not.toBeNull();
  });

  it("audit hash chain is valid after 5 sequential transitions", async () => {
    const { createTask, transition } = await import("../src/workflow/TaskWorkflow.js");
    const { verifyChain } = await import("../src/security/AuditHashChain.js");
    const task = createTask({ actorAgentId: "agent-a" });
    transition(task.id, "INTENT_CLASSIFIED");
    transition(task.id, "SEARCH_QUERY_BUILT");
    transition(task.id, "LOCAL_SEARCH_RUNNING");
    transition(task.id, "CANDIDATES_RANKED");
    const result = verifyChain();
    expect(result.valid).toBe(true);
  });

  it("mutated details_json causes verifyChain to return brokenAt", async () => {
    const { createTask } = await import("../src/workflow/TaskWorkflow.js");
    const { appendAuditEvent, verifyChain } = await import("../src/security/AuditHashChain.js");
    const { getDb } = await import("../src/db/connection.js");

    createTask({ actorAgentId: "agent-a" });
    appendAuditEvent({ actorAgentId: "agent-a", eventType: "TEST_EVENT", detailsJson: { x: 1 } });

    // Tamper with the first row
    const db: DatabaseSync = getDb();
    const first = db.prepare("SELECT id FROM audit_events ORDER BY id ASC LIMIT 1").get() as { id: number };
    db.prepare("UPDATE audit_events SET details_json = ? WHERE id = ?").run(JSON.stringify({ x: 999 }), first.id);

    const result = verifyChain();
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBeDefined();
  });
});
