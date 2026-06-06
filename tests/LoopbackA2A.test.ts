import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { startLoopbackAgents } from "../src/loopback/LoopbackTestHarness.js";

let harness: Awaited<ReturnType<typeof startLoopbackAgents>>;

/** Swap process.env to the given agent's values, run fn, then restore. */
async function withEnv<T>(agent: { env: Record<string, string> }, fn: () => Promise<T>): Promise<T> {
  const saved: Record<string, string | undefined> = {};
  const keys = Object.keys(agent.env);
  for (const k of keys) { saved[k] = process.env[k]; process.env[k] = agent.env[k]; }
  try { return await fn(); }
  finally { for (const k of keys) process.env[k] = saved[k]; }
}

function agentUrl(port: number, path: string) {
  return `http://127.0.0.1:${port}${path}`;
}

describe("Loopback two-agent A2A", () => {
  beforeAll(async () => {
    harness = await startLoopbackAgents();
  }, 30000);

  afterAll(async () => {
    if (harness) await harness.cleanup();
  }, 10000);

  it("both agents have distinct profile/agent IDs after init", async () => {
    const dataA = await withEnv(harness.agentA, async () => {
      const res = await fetch(agentUrl(harness.agentA.port, "/profile/init"), { method: "POST" });
      return (await res.json()) as { identity: { agentId: string; did: string } };
    });

    const dataB = await withEnv(harness.agentB, async () => {
      const res = await fetch(agentUrl(harness.agentB.port, "/profile/init"), { method: "POST" });
      return (await res.json()) as { identity: { agentId: string; did: string } };
    });

    expect(dataA.identity.agentId).toBeDefined();
    expect(dataB.identity.agentId).toBeDefined();
    expect(dataA.identity.agentId).not.toBe(dataB.identity.agentId);
    expect(dataA.identity.did).toMatch(/^did:key:/);
    expect(dataB.identity.did).toMatch(/^did:key:/);
  });

  it("Agent A fetches Agent B's agent card", async () => {
    const card = await withEnv(harness.agentB, async () => {
      const res = await fetch(agentUrl(harness.agentB.port, "/.well-known/agent-card.json"));
      return (await res.json()) as { name: string; protocolVersion: string; version: string; preferredTransport: string; additionalInterfaces: Array<{ transport: string; url: string }>; skills: Array<{ id: string }> };
    });
    expect(card.name).toBe("Oracle Amigo Local Agent");
    expect(card.version).toMatch(/^\d+\.\d+\.\d+/);
    // A2A v0.3.0 compliance: preferredTransport + additionalInterfaces
    expect(card.protocolVersion).toBe("0.3.0");
    expect(card.preferredTransport).toBe("JSONRPC");
    expect(card.additionalInterfaces[0].transport).toBe("JSONRPC");
    expect(card.skills.find((s) => s.id === "file.request.search")).toBeDefined();
  });

  it("ANP handshake between two agents succeeds", async () => {
    // Agent B creates identity
    const identB = await withEnv(harness.agentB, async () => {
      const res = await fetch(agentUrl(harness.agentB.port, "/profile/init"), { method: "POST" });
      return (await res.json()) as { identity: { agentId: string; did: string; publicKey: string } };
    });

    // Agent A creates identity (need its public key to verify A's response signature)
    const identA = await withEnv(harness.agentA, async () => {
      const res = await fetch(agentUrl(harness.agentA.port, "/profile/init"), { method: "POST" });
      return (await res.json()) as { identity: { agentId: string; did: string; publicKey: string } };
    });

    // Agent B creates handshake offer
    const offer = await withEnv(harness.agentB, async () => {
      const res = await fetch(agentUrl(harness.agentB.port, "/anp/handshake/offer"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ peer: identB.identity.agentId }),
      });
      return (await res.json()) as { offerId: string; peer: string; nonce: string; createdAt: string; signature: string };
    });

    // Agent A verifies the offer using agent B's public key
    const verifyData = await withEnv(harness.agentA, async () => {
      const res = await fetch(agentUrl(harness.agentA.port, "/anp/handshake/verify-offer"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ offer, publicKey: identB.identity.publicKey }),
      });
      return (await res.json()) as { ok: boolean };
    });
    expect(verifyData.ok).toBe(true);

    // Agent A creates response (signed by A's identity)
    const response = await withEnv(harness.agentA, async () => {
      const res = await fetch(agentUrl(harness.agentA.port, "/anp/handshake/response"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ offer }),
      });
      const json = (await res.json()) as { responseId: string; offerId: string; nonce: string; status: string; createdAt: string; signature: string };
      return json;
    });
    expect(response.status).toBe("accepted");

    // Agent B verifies the response using A's public key (A signed it)
    const verifyDataB = await withEnv(harness.agentB, async () => {
      const res = await fetch(agentUrl(harness.agentB.port, "/anp/handshake/verify-response"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response, publicKey: identA.identity.publicKey }),
      });
      return (await res.json()) as { ok: boolean };
    });
    expect(verifyDataB.ok).toBe(true);
  });

  it("A2A file request creates a task on the receiving agent", async () => {
    const data = await withEnv(harness.agentB, async () => {
      const res = await fetch(agentUrl(harness.agentB.port, "/a2a/v1"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "find API design document", type: "file.request.search" }),
      });
      expect(res.ok).toBe(true);
      return (await res.json()) as { task: { id: string; status: string } };
    });
    expect(data.task.id).toBeDefined();
    expect(data.task.status).toBeDefined();

    await withEnv(harness.agentB, async () => {
      const taskRes = await fetch(agentUrl(harness.agentB.port, `/a2a/tasks/${data.task.id}`));
      expect(taskRes.ok).toBe(true);
    });
  });

  it("audit chain validates after multiple events", async () => {
    const result = await withEnv(harness.agentB, async () => {
      const res = await fetch(agentUrl(harness.agentB.port, "/audit/verify"));
      expect(res.ok).toBe(true);
      return (await res.json()) as { valid: boolean };
    });
    expect(result.valid).toBe(true);
  });
});
