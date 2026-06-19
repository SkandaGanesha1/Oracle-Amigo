import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
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
  name: "skanda" | "docin";
  port: number;
  child: ChildProcess;
}

interface ConversationResponse {
  conversation: { id: string };
}

interface MessagesResponse {
  conversationId: string;
  messages: Array<{ id: string; text?: string; delivery_status?: string }>;
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runId = Date.now();
const workDir = mkdtempSync(join(tmpdir(), `oracle-amigo-live-message-e2e-${runId}-`));
const cpPort = 20200 + Math.floor(Math.random() * 500);
const controlPlaneUrl = `http://127.0.0.1:${cpPort}`;
const localApiToken = "live-message-local-api-token-000000000000";

async function main(): Promise<void> {
  resetConfigForTest({
    CONTROL_PLANE_PORT: String(cpPort),
    CONTROL_PLANE_HOST: "127.0.0.1",
    CONTROL_PLANE_PUBLIC_URL: controlPlaneUrl,
    CONTROL_PLANE_DB_PATH: join(workDir, "control-plane.db"),
    JWT_ACCESS_SECRET: "live-message-access-secret-must-be-16+",
    JWT_REFRESH_SECRET: "live-message-refresh-secret-must-be-16+",
    FILE_TRANSFER_STORE: join(workDir, "cloud-transfers"),
    DEFAULT_ORG_SLUG: "live-message-e2e",
    DEV_ADMIN_TOKEN: "live-message-admin-token",
    CONTROL_PLANE_ENV: "test"
  });
  closeAll();

  const controlPlane = await buildApp();
  const agents: AgentProc[] = [];
  try {
    await controlPlane.listen({ host: "127.0.0.1", port: cpPort });
    const [skandaPort, docinPort] = await allocateAgentPorts();
    const skanda = await startAgent("skanda", skandaPort);
    const docin = await startAgent("docin", docinPort);
    agents.push(skanda, docin);

    const skandaSignup = await agentJson(skanda, "/cloud/signup", {
      email: `live-skanda-${runId}@example.com`,
      password: "securePass123!",
      display_name: "Skanda",
      control_plane_url: controlPlaneUrl
    });
    const docinSignup = await agentJson(docin, "/cloud/signup", {
      email: `live-docin-${runId}@example.com`,
      password: "securePass123!",
      display_name: "Docin",
      control_plane_url: controlPlaneUrl
    });

    const skandaEnroll = await agentJson(skanda, "/cloud/enroll", {
      device_name: "Skanda live laptop",
      agent_display_name: "Skanda personal agent",
      capabilities: ["a2a.v1", "message.send", "file.request"]
    });
    const docinEnroll = await agentJson(docin, "/cloud/enroll", {
      device_name: "Docin live laptop",
      agent_display_name: "Docin personal agent",
      capabilities: ["a2a.v1", "message.send", "file.request"]
    });

    const cp = new ControlPlaneClient(controlPlaneUrl);
    const presence = new PresenceClient(cp);
    await presence.heartbeat({ agent_instance_id: skandaEnroll.agent_instance_id, status: "online" }, skandaEnroll.device_access_token);
    await presence.heartbeat({ agent_instance_id: docinEnroll.agent_instance_id, status: "online" }, docinEnroll.device_access_token);

    const skandaUserId = userIdFromSignup(skandaSignup);
    const docinUserId = userIdFromSignup(docinSignup);

    const skandaToDocin = await agentJson<ConversationResponse>(skanda, "/chat/conversations", {
      title: "Docin",
      mode: "cloud_relay",
      peer_user_id: docinUserId,
      peer_agent_instance_id: docinEnroll.agent_instance_id
    });
    const docinToSkanda = await agentJson<ConversationResponse>(docin, "/chat/conversations", {
      title: "Skanda",
      mode: "cloud_relay",
      peer_user_id: skandaUserId,
      peer_agent_instance_id: skandaEnroll.agent_instance_id
    });
    assert(skandaToDocin.conversation.id === `relay_user_${docinUserId}`, "Skanda chat uses canonical Docin conversation id");
    assert(docinToSkanda.conversation.id === `relay_user_${skandaUserId}`, "Docin chat uses canonical Skanda conversation id");

    await agentJson(docin, `/chat/conversations/${encodeURIComponent(docinToSkanda.conversation.id)}/messages`, {
      text: "hello skanda",
      client_message_id: `msg-docin-skanda-${runId}`
    });

    await waitFor(async () => {
      const messages = await agentGet<MessagesResponse>(skanda, `/chat/conversations/${encodeURIComponent(skandaToDocin.conversation.id)}/messages`);
      return messages.messages.some((message) => message.text === "hello skanda");
    }, "Skanda receives Docin message without hard refresh", 5_000);

    await agentJson(skanda, `/chat/conversations/${encodeURIComponent(skandaToDocin.conversation.id)}/messages`, {
      text: "hello docin",
      client_message_id: `msg-skanda-docin-${runId}`
    });

    await waitFor(async () => {
      const messages = await agentGet<MessagesResponse>(docin, `/chat/conversations/${encodeURIComponent(docinToSkanda.conversation.id)}/messages`);
      return messages.messages.some((message) => message.text === "hello docin");
    }, "Docin receives Skanda message without hard refresh", 5_000);

    console.log("PASS two-agent live relay messages without hard refresh");
  } finally {
    await Promise.all(agents.map((agent) => stopAgent(agent)));
    await controlPlane.close();
    closeAll();
    try {
      rmSync(workDir, { recursive: true, force: true });
    } catch {
      // Windows may hold stdio handles briefly after process shutdown.
    }
  }
}

async function startAgent(name: "skanda" | "docin", port: number): Promise<AgentProc> {
  const dir = join(workDir, name);
  const storageRoot = join(dir, "storage");
  mkdirSync(storageRoot, { recursive: true });
  const env = {
    ...process.env,
    SANDBOX_PORT: String(port),
    AGENTIC_AGENT_PORT: String(port),
    AGENTIC_PROFILE_ID: name,
    AGENTIC_DB_PATH: join(dir, "oracle-amigo.db"),
    AGENTIC_STORAGE_ROOT: storageRoot,
    CONTROL_PLANE_URL: controlPlaneUrl,
    AGENTIC_RELAY_MODE: "polling",
    AGENTIC_HEARTBEAT_INTERVAL_SECONDS: "2",
    AGENTIC_RELAY_POLL_INTERVAL_SECONDS: "1",
    LOCAL_AGENT_API_TOKEN: localApiToken,
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
  await waitFor(() => fetch(`http://127.0.0.1:${port}/health`).then((r) => r.ok).catch(() => false), `${name} health`);
  return { name, port, child };
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
        if (address && typeof address === "object") resolve(address.port);
        else reject(new Error("Failed to allocate a free loopback port"));
      });
    });
  });
}

async function agentGet<T = any>(agent: AgentProc, path: string): Promise<T> {
  const res = await fetch(`http://127.0.0.1:${agent.port}${path}`, {
    headers: { "x-local-agent-token": localApiToken }
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${agent.name} GET ${path} failed: ${res.status} ${JSON.stringify(body)}`);
  return body as T;
}

async function agentJson<T = any>(agent: AgentProc, path: string, payload: unknown): Promise<T> {
  const res = await fetch(`http://127.0.0.1:${agent.port}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-local-agent-token": localApiToken },
    body: JSON.stringify(payload)
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${agent.name} POST ${path} failed: ${res.status} ${JSON.stringify(body)}`);
  return body as T;
}

async function waitFor(fn: () => Promise<boolean> | boolean, label: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function userIdFromSignup(signup: any): string {
  const value = signup?.user?.id ?? signup?.user?.user_id ?? signup?.user_id;
  if (typeof value !== "string" || !value) throw new Error(`Signup response did not include user id: ${JSON.stringify(signup)}`);
  return value;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

main().then(() => {
  process.exit(0);
}).catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
