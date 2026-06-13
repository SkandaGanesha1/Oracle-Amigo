import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deleteAgent, getAgent, listAgents, setTrustLevel, upsertAgent, type AgentRegistryRecord } from "../src/registry/AgentRegistry.js";
import { discoverAndRegister, fetchAgentCard, hashCard, refreshAgent } from "../src/registry/AgentDiscovery.js";
import { _resetDb } from "../src/db/connection.js";

const SAMPLE_DID = "did:wba:example.com:e1_0000000000000000000000000000000000000000000000000000000000000000";

beforeEach(() => {
  process.env.AGENTIC_DB_PATH = ":memory:";
  _resetDb();
});

afterEach(() => {
  _resetDb();
  delete process.env.AGENTIC_DB_PATH;
});

describe("AgentRegistry CRUD", () => {
  it("inserts a new agent", () => {
    const r = upsertAgent({ did: SAMPLE_DID, name: "Test Agent", trustLevel: "trusted" });
    expect(r.did).toBe(SAMPLE_DID);
    expect(r.name).toBe("Test Agent");
    expect(r.trustLevel).toBe("trusted");
    expect(r.firstSeen).toBeTruthy();
  });

  it("updates an existing agent by did", () => {
    upsertAgent({ did: SAMPLE_DID, name: "Original" });
    const updated = upsertAgent({ did: SAMPLE_DID, name: "Renamed", description: "new desc" });
    expect(updated.name).toBe("Renamed");
    expect(updated.description).toBe("new desc");
    expect(listAgents()).toHaveLength(1);
  });

  it("getAgent returns null for unknown did", () => {
    expect(getAgent("did:unknown")).toBeNull();
  });

  it("listAgents filters by trustLevel", () => {
    upsertAgent({ did: "did:a", name: "A", trustLevel: "trusted" });
    upsertAgent({ did: "did:b", name: "B", trustLevel: "discovered" });
    upsertAgent({ did: "did:c", name: "C", trustLevel: "trusted" });
    const trusted = listAgents({ trustLevel: "trusted" });
    expect(trusted).toHaveLength(2);
    const discovered = listAgents({ trustLevel: "discovered" });
    expect(discovered).toHaveLength(1);
  });

  it("deleteAgent removes by did", () => {
    upsertAgent({ did: SAMPLE_DID, name: "X" });
    expect(deleteAgent(SAMPLE_DID)).toBe(true);
    expect(getAgent(SAMPLE_DID)).toBeNull();
    expect(deleteAgent(SAMPLE_DID)).toBe(false);
  });

  it("setTrustLevel updates trust and last_seen", () => {
    upsertAgent({ did: SAMPLE_DID, name: "X", trustLevel: "discovered" });
    const updated = setTrustLevel(SAMPLE_DID, "blocked");
    expect(updated?.trustLevel).toBe("blocked");
  });

  it("persists supportedProtocols and skills as JSON", () => {
    upsertAgent({
      did: SAMPLE_DID,
      name: "X",
      supportedProtocols: ["JSONRPC/1.0", "ANP/1.0"],
      skills: ["file-search", "approval-workflow"],
    });
    const r = getAgent(SAMPLE_DID)!;
    expect(r.supportedProtocols).toEqual(["JSONRPC/1.0", "ANP/1.0"]);
    expect(r.skills).toEqual(["file-search", "approval-workflow"]);
  });
});

describe("hashCard", () => {
  it("produces same hash for equivalent cards regardless of key order", () => {
    const a = { name: "X", description: "d", skills: [] } as any;
    const b = { description: "d", skills: [], name: "X" } as any;
    expect(hashCard(a)).toBe(hashCard(b));
  });
});

describe("fetchAgentCard", () => {
  it("fetches and hashes a card", async () => {
    const card = sampleCard({ name: "Remote", description: "remote agent" });
    const fetchMock = vi.fn().mockResolvedValue(mockJsonResponse(card));
    const result = await fetchAgentCard({ url: "https://example.com/card.json", fetchImpl: fetchMock as any });
    expect(result.card).toEqual(card);
    expect(result.cardHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("throws on non-2xx", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ...mockJsonResponse({}), ok: false, status: 404 });
    await expect(fetchAgentCard({ url: "https://example.com/x", fetchImpl: fetchMock as any })).rejects.toThrow(/404/);
  });
});

describe("discoverAndRegister", () => {
  it("fetches card and registers agent with supported protocols + skills", async () => {
    const card = sampleCard({
      id: "did:wba:remote.example.com:e1_abc",
      name: "Remote Agent",
      description: "an agent",
      additionalInterfaces: [
        { url: "https://remote.example.com/a2a/jsonrpc", transport: "JSONRPC" },
        { url: "https://remote.example.com/anp/message", transport: "ANP" },
      ],
      skills: [{ id: "file-search", name: "File Search", description: "Search files", tags: [] }],
    });
    const fetchMock = vi.fn().mockResolvedValue(mockJsonResponse(card));
    const result = await discoverAndRegister({ url: "https://example.com/card.json", fetchImpl: fetchMock as any });
    expect(result.did).toBe("did:wba:remote.example.com:e1_abc");
    const record = getAgent(result.did)!;
    expect(record.name).toBe("Remote Agent");
    expect(record.supportedProtocols).toContain("JSONRPC");
    expect(record.supportedProtocols).toContain("ANP");
    expect(record.skills).toEqual(["file-search"]);
    expect(record.anpEndpoint).toBe("https://remote.example.com/anp/message");
  });
});

describe("refreshAgent", () => {
  it("returns null when no agentCardUrl is stored", async () => {
    upsertAgent({ did: SAMPLE_DID, name: "X" });
    const result = await refreshAgent(SAMPLE_DID);
    expect(result).toBeNull();
  });

  it("returns null when agent does not exist", async () => {
    const result = await refreshAgent("did:nonexistent");
    expect(result).toBeNull();
  });

  it("re-fetches and updates lastCardHash", async () => {
    upsertAgent({ did: SAMPLE_DID, name: "X", agentCardUrl: "https://example.com/card" });
    const card = sampleCard({ name: "X", description: "updated" });
    const fetchMock = vi.fn().mockResolvedValue(mockJsonResponse(card));
    const result = await refreshAgent(SAMPLE_DID, fetchMock as any);
    expect(result?.card.name).toBe("X");
    const record = getAgent(SAMPLE_DID)!;
    expect(record.lastCardHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

function sampleCard(overrides: Record<string, unknown> = {}) {
  return {
    protocolVersion: "0.3.0",
    name: "Remote",
    description: "",
    url: "https://remote.example.com/a2a/jsonrpc",
    preferredTransport: "JSONRPC",
    version: "0.1.0",
    capabilities: {},
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["application/json"],
    skills: [],
    ...overrides
  };
}

function mockJsonResponse(body: unknown) {
  const text = JSON.stringify(body);
  return {
    ok: true,
    status: 200,
    headers: new Headers({
      "content-type": "application/json",
      "content-length": String(Buffer.byteLength(text, "utf8"))
    }),
    text: async () => text
  };
}
