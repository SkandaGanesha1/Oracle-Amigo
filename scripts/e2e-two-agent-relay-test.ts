import { createHash } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { buildApp } from "../apps/control-plane/src/main.js";
import { resetConfigForTest } from "../apps/control-plane/src/config.js";
import { closeAll } from "../apps/control-plane/src/db/connection.js";
import { ControlPlaneClient } from "../src/cloud/ControlPlaneClient.js";
import { PresenceClient } from "../src/cloud/PresenceClient.js";

interface AgentProc {
  name: "alice" | "bob";
  port: number;
  dbPath: string;
  storageRoot: string;
  profileId: string;
  child: ChildProcess;
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runId = Date.now();
const workDir = join(tmpdir(), `oracle-amigo-relay-e2e-${runId}`);
const cpPort = 19700 + Math.floor(Math.random() * 500);
const controlPlaneUrl = `http://127.0.0.1:${cpPort}`;
const localApiToken = "relay-e2e-local-api-token-000000000000";

async function main(): Promise<void> {
  mkdirSync(workDir, { recursive: true });
  const bobDocs = join(workDir, "bob", "storage", "docs");
  mkdirSync(bobDocs, { recursive: true });
  const fileBytes = Buffer.from(`Oracle Amigo API design document\nrun=${runId}\n`, "utf8");
  const bobFile = join(bobDocs, "API_Design_v4_Final.txt");
  writeFileSync(bobFile, fileBytes);
  const expectedSha = createHash("sha256").update(fileBytes).digest("hex");

  resetConfigForTest({
    CONTROL_PLANE_PORT: String(cpPort),
    CONTROL_PLANE_HOST: "127.0.0.1",
    CONTROL_PLANE_PUBLIC_URL: controlPlaneUrl,
    CONTROL_PLANE_DB_PATH: join(workDir, "control-plane.db"),
    JWT_ACCESS_SECRET: "relay-e2e-access-secret-must-be-16+",
    JWT_REFRESH_SECRET: "relay-e2e-refresh-secret-must-be-16+",
    FILE_TRANSFER_STORE: join(workDir, "cloud-transfers"),
    DEFAULT_ORG_SLUG: "relay-e2e",
    DEV_ADMIN_TOKEN: "relay-e2e-admin-token",
    CONTROL_PLANE_ENV: "test"
  });
  closeAll();

  const controlPlane = await buildApp();
  const agents: AgentProc[] = [];
  try {
    await controlPlane.listen({ host: "127.0.0.1", port: cpPort });
    const [alicePort, bobPort] = await allocateAgentPorts();
    const alice = await startAgent("alice", alicePort);
    const bob = await startAgent("bob", bobPort);
    agents.push(alice, bob);

    const aliceSignup = await agentJson(alice, "/cloud/signup", {
      email: `relay-alice-${runId}@example.com`,
      password: "securePass123!",
      display_name: "Alice Relay",
      control_plane_url: controlPlaneUrl
    });
    const bobSignup = await agentJson(bob, "/cloud/signup", {
      email: `relay-bob-${runId}@example.com`,
      password: "securePass123!",
      display_name: "Bob Relay",
      control_plane_url: controlPlaneUrl
    });

    const aliceEnroll = await agentJson(alice, "/cloud/enroll", {
      device_name: "Alice relay laptop",
      agent_display_name: "Alice personal agent",
      capabilities: ["a2a.v1", "file.request", "fileTransfer"]
    });
    const bobEnroll = await agentJson(bob, "/cloud/enroll", {
      device_name: "Bob relay laptop",
      agent_display_name: "Bob personal agent",
      capabilities: ["a2a.v1", "file.request", "fileTransfer"]
    });

    await waitFor(() => agentGet(alice, "/cloud/status").then((s) => s.cloud?.status === "enrolled"), "Alice enrolled");
    await waitFor(() => agentGet(bob, "/cloud/status").then((s) => s.cloud?.status === "enrolled"), "Bob enrolled");

    const cp = new ControlPlaneClient(controlPlaneUrl);
    const presence = new PresenceClient(cp);
    await presence.heartbeat({ agent_instance_id: aliceEnroll.agent_instance_id, status: "online" }, aliceEnroll.device_access_token);
    await presence.heartbeat({ agent_instance_id: bobEnroll.agent_instance_id, status: "online" }, bobEnroll.device_access_token);

    const adminPresence = await cp.getJson<{ presence: Array<{ agent_instance_id: string; status: string }> }>(
      "/v1/admin/presence",
      "relay-e2e-admin-token"
    );
    assert(adminPresence.presence.some((p) => p.agent_instance_id === aliceEnroll.agent_instance_id && p.status === "online"), "admin sees Alice online");
    assert(adminPresence.presence.some((p) => p.agent_instance_id === bobEnroll.agent_instance_id && p.status === "online"), "admin sees Bob online");

    const directory = await agentGet(alice, `/cloud/directory/users?q=${encodeURIComponent("bob")}`);
    assert(directory.users.some((u: { email: string }) => u.email === bobSignup.user.email), "Alice directory search finds Bob");

    await agentJson(bob, "/files/index-roots", { roots: [bobDocs] });
    await agentJson(bob, "/files/reindex", { roots: [bobDocs] });

    const sent = await agentJson(alice, "/relay/send-file-request", {
      to_agent_instance_id: bobEnroll.agent_instance_id,
      text: "Can you send me the API design document?",
      a2a_task_id: `relay-file-request-${runId}`,
      idempotency_key: `relay-file-request-${runId}`
    });
    assert(Boolean(sent.relay_task_id), "Alice sent relay file request");

    let lastBobInboxStatus: unknown = null;
    await waitFor(async () => {
      lastBobInboxStatus = await agentGet(bob, "/relay/inbox/status");
      const pending = await agentGet(bob, "/approvals/pending");
      return pending.approvals.some((a: Record<string, unknown>) => approvalRequesterAgentId(a) === aliceEnroll.agent_instance_id);
    }, () => `Bob approval card appears; inbox=${JSON.stringify(lastBobInboxStatus)}`);

    const pending = await agentGet(bob, "/approvals/pending");
    const approval = pending.approvals.find((a: Record<string, unknown>) => approvalRequesterAgentId(a) === aliceEnroll.agent_instance_id);
    assert(Boolean(approval), "Bob has approval");
    const approved = await agentJson(bob, `/approvals/${encodeURIComponent(approval.id)}/approve`, {
      idempotency_key: `approve-${approval.id}`
    });
    const transferId = approved.cloudTransfer?.transferId;
    assert(
      typeof transferId === "string" && transferId.length > 0,
      `Bob approval created relay transfer: ${JSON.stringify(approved.cloudTransfer)}`
    );

    await waitFor(async () => {
      const files = await agentGet(alice, "/storage/files");
      return files.files.some((file: { sha256: string; originalFileName: string }) =>
        file.sha256 === expectedSha && file.originalFileName === "API_Design_v4_Final.txt"
      );
    }, "Alice stores and verifies received file");

    const adminTasks = await cp.getJson<{ tasks: Array<{ id: string; status: string }> }>("/v1/admin/tasks", "relay-e2e-admin-token");
    await waitFor(async () => {
      const adminTransfers = await cp.getJson<{ transfers: Array<{ id: string; status: string; sha256: string }> }>("/v1/admin/transfers", "relay-e2e-admin-token");
      return adminTransfers.transfers.some((t) => t.id === transferId && t.status === "completed" && t.sha256 === expectedSha);
    }, "admin sees completed transfer");
    const adminAudit = await cp.getJson<{ events: unknown[] }>("/v1/admin/audit", "relay-e2e-admin-token");
    assert(adminTasks.tasks.some((t) => t.id === sent.relay_task_id), "admin sees relay task");
    assert(adminAudit.events.length > 0, "admin sees audit events");

    console.log("PASS two-agent relay file request");
  } finally {
    for (const agent of agents) await stopAgent(agent);
    await controlPlane.close();
    closeAll();
    try {
      rmSync(workDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup timing on Windows
    }
  }
}

async function startAgent(name: "alice" | "bob", port: number): Promise<AgentProc> {
  const dir = join(workDir, name);
  const storageRoot = join(dir, "storage");
  mkdirSync(storageRoot, { recursive: true });
  const dbPath = join(dir, "oracle-amigo.db");
  const env = {
    ...process.env,
    SANDBOX_PORT: String(port),
    AGENTIC_AGENT_PORT: String(port),
    AGENTIC_PROFILE_ID: name,
    AGENTIC_DB_PATH: dbPath,
    AGENTIC_STORAGE_ROOT: storageRoot,
    CONTROL_PLANE_URL: controlPlaneUrl,
    AGENTIC_RELAY_MODE: "polling",
    AGENTIC_HEARTBEAT_INTERVAL_SECONDS: "2",
    AGENTIC_RELAY_POLL_INTERVAL_SECONDS: "1",
    LOCAL_AGENT_API_TOKEN: localApiToken,
    SANDBOX_FILE_SEARCH_ROOTS: storageRoot,
    LOCALAPPDATA: dir
  };
  const child = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], {
    cwd: root,
    env,
    stdio: "pipe",
    windowsHide: true
  });
  child.stdout?.on("data", (chunk) => process.stdout.write(`[${name}] ${chunk}`));
  child.stderr?.on("data", (chunk) => process.stderr.write(`[${name}] ${chunk}`));
  const agent = { name, port, dbPath, storageRoot, profileId: name, child };
  await waitFor(() => fetch(`http://127.0.0.1:${port}/health`).then((r) => r.ok).catch(() => false), `${name} health`);
  return agent;
}

async function stopAgent(agent: AgentProc): Promise<void> {
  if (agent.child.killed || agent.child.exitCode !== null) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      if (!agent.child.killed) agent.child.kill("SIGKILL");
      resolve();
    }, 1500);
    agent.child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    agent.child.kill();
  });
}

async function allocateAgentPorts(): Promise<[number, number]> {
  const first = await getFreePort();
  let second = await getFreePort();
  while (second === first) second = await getFreePort();
  return [first, second];
}

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === "object") {
          resolve(address.port);
        } else {
          reject(new Error("Failed to allocate a free loopback port"));
        }
      });
    });
  });
}

async function agentGet(agent: AgentProc, path: string): Promise<any> {
  const res = await fetch(`http://127.0.0.1:${agent.port}${path}`, {
    headers: { "x-local-agent-token": localApiToken }
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${agent.name} GET ${path} failed: ${res.status} ${JSON.stringify(body)}`);
  return body;
}

async function agentJson(agent: AgentProc, path: string, payload: unknown): Promise<any> {
  const res = await fetch(`http://127.0.0.1:${agent.port}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-local-agent-token": localApiToken },
    body: JSON.stringify(payload)
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${agent.name} POST ${path} failed: ${res.status} ${JSON.stringify(body)}`);
  return body;
}

async function waitFor(fn: () => Promise<boolean> | boolean, label: string | (() => string), timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const renderedLabel = typeof label === "function" ? label() : label;
  throw new Error(`Timed out waiting for ${renderedLabel}`);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function approvalRequesterAgentId(approval: Record<string, unknown>): string | undefined {
  const value = approval.requesterAgentId ?? approval.requester_agent_id;
  return typeof value === "string" ? value : undefined;
}

main().then(() => {
  process.exit(0);
}).catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
