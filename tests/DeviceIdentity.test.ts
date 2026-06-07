import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tmpDb = join(tmpdir(), `test-identity-${Date.now()}.db`);
const tmpKeys = join(tmpdir(), `test-keys-${Date.now()}`);

describe("DeviceIdentity", () => {
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

  it("generateOrLoadIdentity returns same agent_id on second call (persisted)", async () => {
    const { generateOrLoadIdentity } = await import("../src/security/DeviceIdentity.js");
    const first = generateOrLoadIdentity("Alice");
    const second = generateOrLoadIdentity("Alice");
    expect(first.agentId).toBe(second.agentId);
    expect(first.did).toBe(second.did);
    expect(first.publicKey).toBe(second.publicKey);
  });

  it("generated DID starts with did:key:", async () => {
    const { generateOrLoadIdentity } = await import("../src/security/DeviceIdentity.js");
    const identity = generateOrLoadIdentity();
    expect(identity.did).toMatch(/^did:key:/);
  });
});

describe("AnpHandshakeAdapter", () => {
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

  it("handshake offer → verify round-trip passes with correct keys", async () => {
    const { generateOrLoadIdentity } = await import("../src/security/DeviceIdentity.js");
    const { createHandshakeOffer, verifyHandshakeOfferSync } = await import("../src/security/AnpHandshakeAdapter.js");
    const identity = generateOrLoadIdentity();
    const offer = createHandshakeOffer(identity, "peer-agent-1");
    expect(verifyHandshakeOfferSync(offer, identity.publicKey)).toBe(true);
  });

  it("handshake response → verify round-trip passes", async () => {
    const { generateOrLoadIdentity } = await import("../src/security/DeviceIdentity.js");
    const { createHandshakeOffer, createHandshakeResponse, verifyHandshakeResponseSync } = await import("../src/security/AnpHandshakeAdapter.js");
    const identityA = generateOrLoadIdentity();
    const offer = createHandshakeOffer(identityA, "peer-b");
    const response = createHandshakeResponse(offer, identityA);
    expect(verifyHandshakeResponseSync(response, identityA.publicKey)).toBe(true);
  });

  it("tampered nonce → verifyHandshakeResponse returns false", async () => {
    const { generateOrLoadIdentity } = await import("../src/security/DeviceIdentity.js");
    const { createHandshakeOffer, createHandshakeResponse, verifyHandshakeResponseSync } = await import("../src/security/AnpHandshakeAdapter.js");
    const identity = generateOrLoadIdentity();
    const offer = createHandshakeOffer(identity, "peer-b");
    const response = createHandshakeResponse(offer, identity);
    const tampered = { ...response, nonce: "00000000" };
    expect(verifyHandshakeResponseSync(tampered, identity.publicKey)).toBe(false);
  });
});

describe("ApprovalBinding", () => {
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

  it("bindApproval is idempotent — same requestId returns same record", async () => {
    const { bindApproval } = await import("../src/security/ApprovalBinding.js");
    const input = {
      requestId: "req-idempotent-001",
      taskId: "task-001",
      filePath: "C:/Users/test/doc.pdf",
      sha256: "abc123",
      sizeBytes: 1024,
      recipientAgentId: "agent-b",
      ownerAgentId: "agent-a",
    };
    const first = bindApproval(input);
    const second = bindApproval(input);
    expect(first.id).toBe(second.id);
    expect(first.boundSha256).toBe(second.boundSha256);
  });
});
