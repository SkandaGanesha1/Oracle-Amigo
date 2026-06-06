import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../server.js";

export async function startLoopbackAgents() {
  const tmpA = join(tmpdir(), `loopback-A-${Date.now()}`);
  const tmpB = join(tmpdir(), `loopback-B-${Date.now()}`);
  mkdirSync(tmpA, { recursive: true });
  mkdirSync(tmpB, { recursive: true });

  const portA = 3399;
  const portB = 3400;

  const storageA = join(tmpA, "storage");
  const dbPathA = join(tmpA, "oracle-amigo.db");
  const storageB = join(tmpB, "storage");
  const dbPathB = join(tmpB, "oracle-amigo.db");

  process.env.SANDBOX_PORT = String(portA);
  process.env.AGENTIC_DB_PATH = dbPathA;
  process.env.AGENTIC_STORAGE_ROOT = storageA;
  process.env.LOCALAPPDATA = tmpA;

  const serverA = buildServer();
  await serverA.listen({ host: "127.0.0.1", port: portA });

  // Save A's env and switch to B
  process.env.SANDBOX_PORT = String(portB);
  process.env.AGENTIC_DB_PATH = dbPathB;
  process.env.AGENTIC_STORAGE_ROOT = storageB;
  process.env.LOCALAPPDATA = tmpB;

  const serverB = buildServer();
  await serverB.listen({ host: "127.0.0.1", port: portB });

  return {
    agentA: { server: serverA, port: portA, storage: storageA, db: dbPathA, tmpDir: tmpA, env: { SANDBOX_PORT: String(portA), AGENTIC_DB_PATH: dbPathA, AGENTIC_STORAGE_ROOT: storageA, LOCALAPPDATA: tmpA } },
    agentB: { server: serverB, port: portB, storage: storageB, db: dbPathB, tmpDir: tmpB, env: { SANDBOX_PORT: String(portB), AGENTIC_DB_PATH: dbPathB, AGENTIC_STORAGE_ROOT: storageB, LOCALAPPDATA: tmpB } },
    async fetch(agent: { env: Record<string, string> }, url: string, init?: RequestInit): Promise<Response> {
      const saved: Record<string, string | undefined> = {};
      const keys = Object.keys(agent.env);
      for (const k of keys) { saved[k] = process.env[k]; process.env[k] = agent.env[k]; }
      try { return await fetch(url, init); }
      finally { for (const k of keys) { process.env[k] = saved[k]; } }
    },
    async cleanup() {
      await serverA.close();
      await serverB.close();
      try { rmSync(tmpA, { recursive: true }); } catch { /* ignore */ }
      try { rmSync(tmpB, { recursive: true }); } catch { /* ignore */ }
    },
  };
}
