import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentDecision, AgentReasoner, AgentReasoningContext } from "../src/agent-runs/AgentDecision.js";
import { buildServer } from "../src/server.js";

vi.setConfig({ testTimeout: 30_000 });

const fixtureRoot = resolve("tests/.tmp-agent-runs");
const pdfBytes = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n");

type AgentRunTestBody = {
  runId: string;
  status: string;
  reasoningMode: string;
  searchedRoots: string[];
  iterations: unknown[];
  sandboxSession: { requested?: boolean; created: boolean; sessionId: string | null };
  steps: Array<{ executionTarget: string; command?: string; stdout?: string; stderr?: string; status: string }>;
  fileSearch: { status: string; selectedMatch: { fileName: string; previewUrl: string } | null };
  finalAnswer: { status: string; message: string; selectedFileId?: string } | null;
};

describe("agent run API", () => {
  beforeEach(async () => {
    await rm(fixtureRoot, { recursive: true, force: true });
    await mkdir(fixtureRoot, { recursive: true });
    await writeFile(join(fixtureRoot, "Job Offer-Associate Consultant.pdf"), pdfBytes);
    vi.stubEnv("SANDBOX_DRY_RUN", "true");
    vi.stubEnv("SANDBOX_FILE_SEARCH_ROOTS", fixtureRoot);
  });

  afterEach(async () => {
    await rm(fixtureRoot, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it("creates a host-only run by default and preserves labeled host file-search steps", async () => {
    const server = buildServer();
    const response = await server.inject({
      method: "POST",
      url: "/agent/runs",
      payload: { query: "find the Job Offer-Associate Consultant.pdf file" }
    });

    expect(response.statusCode).toBe(200);
    const initial = response.json<{
      runId: string;
      status: string;
    }>();
    expect(initial.runId).toBeTruthy();
    expect(initial.status).toBe("running");

    const body = await waitForRun(server, initial.runId);

    expect(body.status).toBe("completed");
    expect(body.reasoningMode).toBe("oci-agent-loop");
    expect(body.searchedRoots).toContain(fixtureRoot);
    expect(body.iterations.length).toBeGreaterThanOrEqual(2);
    expect(body.sandboxSession).toMatchObject({ requested: false, created: false, sessionId: null });
    expect(body.steps.some((step) => step.executionTarget === "gondolin-vm-command")).toBe(false);
    expect(body.steps.some((step) => step.executionTarget === "host-file-search" && step.command?.includes("Test-Path"))).toBe(true);
    expect(body.fileSearch.status).toBe("found");
    expect(body.fileSearch.selectedMatch?.fileName).toBe("Job Offer-Associate Consultant.pdf");
    expect(body.finalAnswer?.status).toBe("found");

    const sessions = await server.inject({ method: "GET", url: "/sessions" });
    expect(sessions.json<{ sessions: unknown[] }>().sessions.length).toBe(0);

    const stored = await server.inject({ method: "GET", url: `/agent/runs/${body.runId}` });
    expect(stored.statusCode).toBe(200);
    expect(stored.json<{ runId: string }>().runId).toBe(body.runId);

    const events = await server.inject({ method: "GET", url: `/agent/runs/${body.runId}/events` });
    expect(events.statusCode).toBe(200);
    expect(events.body).toContain("event: snapshot");
    expect(events.body).toContain("host-file-search");

    await server.close();
  });

  it("can explicitly skip Gondolin session creation while preserving host search labels", async () => {
    const server = buildServer();
    const response = await server.inject({
      method: "POST",
      url: "/agent/runs",
      payload: { query: "find the Job Offer-Associate Consultant.pdf file", createSandboxSession: false }
    });

    expect(response.statusCode).toBe(200);
    const initial = response.json<{ runId: string; status: string }>();
    expect(initial.status).toBe("running");

    const body = await waitForRun(server, initial.runId);

    expect(body.sandboxSession).toMatchObject({ requested: false, created: false });
    expect(body.steps.some((step) => step.executionTarget === "gondolin-vm-command")).toBe(false);
    expect(body.steps.some((step) => step.executionTarget === "host-file-search")).toBe(true);
    expect(body.fileSearch.status).toBe("found");

    await server.close();
  });

  it("creates a Gondolin sandbox on demand when the LLM chooses a VM command", async () => {
    const reasoner = new QueueReasoner([
      {
        type: "execute_command",
        reason: "This task needs isolated VM execution.",
        tool: "gondolin-vm-command",
        command: "pwd"
      },
      {
        type: "final_answer",
        reason: "The VM command completed.",
        status: "need_help",
        message: "VM command completed; no file search was requested."
      }
    ]);
    const server = buildServer(undefined, undefined, reasoner);
    const response = await server.inject({
      method: "POST",
      url: "/agent/runs",
      payload: { query: "run pwd in the isolated sandbox" }
    });

    const initial = response.json<{ runId: string; status: string }>();
    const body = await waitForRun(server, initial.runId);

    expect(body.sandboxSession.created).toBe(true);
    expect(body.sandboxSession.sessionId).toBeTruthy();
    expect(body.steps.some((step) => step.executionTarget === "gondolin-vm-command" && step.command === "pwd")).toBe(true);

    const sessions = await server.inject({ method: "GET", url: "/sessions" });
    expect(sessions.json<{ sessions: unknown[] }>().sessions.length).toBe(1);

    await server.close();
  });

  it("uses a mocked LLM reasoner across multiple decisions and blocks unsafe generated host commands", async () => {
    const reasoner = new QueueReasoner([
      {
        type: "execute_command",
        reason: "The model attempted an unsafe host read and policy must block it.",
        tool: "host-file-search",
        command: "Get-Content C:\\Users\\Skanda Ganesha L\\.oci\\config"
      },
      {
        type: "semantic_search",
        reason: "Now use the safe semantic file search tool.",
        query: "find the Job Offer-Associate Consultant.pdf file",
        fileTypes: ["pdf"]
      },
      {
        type: "final_answer",
        reason: "The semantic search found the requested PDF.",
        status: "found",
        message: "Found the requested PDF."
      }
    ]);
    const server = buildServer(undefined, undefined, reasoner);
    const response = await server.inject({
      method: "POST",
      url: "/agent/runs",
      payload: { query: "find the Job Offer-Associate Consultant.pdf file", createSandboxSession: false }
    });

    const initial = response.json<{ runId: string; status: string }>();
    const body = await waitForRun(server, initial.runId);

    expect(body.status).toBe("completed");
    expect(reasoner.calls).toBe(3);
    expect(body.steps.some((step) => step.executionTarget === "host-file-search" && step.status === "skipped")).toBe(true);
    expect(body.steps.some((step) => step.stderr?.includes("read-only"))).toBe(true);
    expect(body.fileSearch.status).toBe("found");
    expect(body.finalAnswer?.status).toBe("found");

    await server.close();
  });

  it("skips repeated broad semantic searches after configured roots are exhausted", async () => {
    const reasoner = new QueueReasoner([
      {
        type: "semantic_search",
        reason: "Search for a file that is not present.",
        query: "missing NonPO invoice India pdf",
        fileTypes: ["pdf"]
      },
      {
        type: "semantic_search",
        reason: "Try the same broad search again.",
        query: "Non PO invoice India pdf",
        fileTypes: ["pdf"]
      },
      {
        type: "final_answer",
        reason: "No match was found in configured roots.",
        status: "not_found",
        message: "No matching file was found."
      }
    ]);
    const server = buildServer(undefined, undefined, reasoner);
    const response = await server.inject({
      method: "POST",
      url: "/agent/runs",
      payload: { query: "find missing NonPO invoice India pdf", createSandboxSession: false }
    });

    const initial = response.json<{ runId: string; status: string }>();
    const body = await waitForRun(server, initial.runId);

    expect(body.status).toBe("partial");
    expect(body.steps.some((step) => step.status === "skipped" && step.stdout?.includes("already returned no match"))).toBe(true);
    expect(reasoner.calls).toBe(3);

    await server.close();
  });
});

async function waitForRun(server: ReturnType<typeof buildServer>, runId: string): Promise<AgentRunTestBody> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const response = await server.inject({ method: "GET", url: `/agent/runs/${runId}` });
    const body = response.json<AgentRunTestBody>();
    if (body.status !== "running") return body;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for run ${runId}`);
}

class QueueReasoner implements AgentReasoner {
  calls = 0;

  constructor(private readonly decisions: AgentDecision[]) {}

  async reasonNextAction(_context: AgentReasoningContext): Promise<AgentDecision> {
    const decision = this.decisions[this.calls] ?? this.decisions.at(-1);
    this.calls += 1;
    if (!decision) throw new Error("No queued decision");
    return decision;
  }
}
