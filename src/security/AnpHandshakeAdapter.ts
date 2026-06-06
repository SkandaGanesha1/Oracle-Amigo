import { createPrivateKey, createPublicKey, randomBytes, randomUUID, sign, verify } from "node:crypto";
import { getDb } from "../db/connection.js";
import { loadPrivateKeyPem, type LocalIdentity } from "./DeviceIdentity.js";

export type HandshakeOffer = {
  offerId: string;
  peer: string;
  nonce: string;
  createdAt: string;
  signature: string; // hex-encoded signature of nonce
};

export type HandshakeResponse = {
  responseId: string;
  offerId: string;
  nonce: string;
  status: "accepted";
  createdAt: string;
  signature: string; // hex-encoded signature of offerId+nonce
};

export type PeerSession = {
  id: number;
  peerAgentId: string;
  peerDid: string;
  peerPublicKey: string;
  trustLevel: "local" | "loopback" | "future";
  status: string;
  createdAt: string;
  expiresAt: string;
};

export function createHandshakeOffer(identity: LocalIdentity, peer: string): HandshakeOffer {
  const nonce = randomBytes(32).toString("hex");
  const offerId = randomUUID();
  const createdAt = new Date().toISOString();
  const privPem = loadPrivateKeyPem(identity);
  const privKey = createPrivateKey(privPem);
  const sig = sign(null, Buffer.from(nonce, "utf8"), privKey);
  return { offerId, peer, nonce, createdAt, signature: sig.toString("hex") };
}

export function verifyHandshakeOffer(offer: HandshakeOffer, publicKeyHex: string): boolean {
  try {
    const pubKey = createPublicKey({ key: hexToDerSpki(publicKeyHex), format: "der", type: "spki" });
    return verify(null, Buffer.from(offer.nonce, "utf8"), pubKey, Buffer.from(offer.signature, "hex"));
  } catch { return false; }
}

export function createHandshakeResponse(offer: HandshakeOffer, identity: LocalIdentity): HandshakeResponse {
  const responseId = randomUUID();
  const createdAt = new Date().toISOString();
  const privPem = loadPrivateKeyPem(identity);
  const privKey = createPrivateKey(privPem);
  const data = Buffer.from(`${offer.offerId}:${offer.nonce}`, "utf8");
  const sig = sign(null, data, privKey);
  return { responseId, offerId: offer.offerId, nonce: offer.nonce, status: "accepted", createdAt, signature: sig.toString("hex") };
}

export function verifyHandshakeResponse(response: HandshakeResponse, publicKeyHex: string): boolean {
  if (response.status !== "accepted") return false;
  try {
    const pubKey = createPublicKey({ key: hexToDerSpki(publicKeyHex), format: "der", type: "spki" });
    const data = Buffer.from(`${response.offerId}:${response.nonce}`, "utf8");
    return verify(null, data, pubKey, Buffer.from(response.signature, "hex"));
  } catch { return false; }
}

export function createOrGetPeerSession(peer: {
  agentId: string; did: string; publicKey: string; trustLevel?: PeerSession["trustLevel"];
}): PeerSession {
  const db = getDb();
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const trustLevel = peer.trustLevel ?? "local";

  const existing = db.prepare(
    "SELECT * FROM peer_sessions WHERE peer_agent_id = ? AND status = 'active' LIMIT 1"
  ).get(peer.agentId) as Record<string, unknown> | undefined;

  if (existing) return rowToPeerSession(existing);

  const result = db.prepare(`
    INSERT INTO peer_sessions (peer_agent_id, peer_did, peer_public_key, trust_level, status, created_at, expires_at)
    VALUES (?, ?, ?, ?, 'active', ?, ?)
  `).run(peer.agentId, peer.did, peer.publicKey, trustLevel, now, expiresAt);

  return {
    id: Number(result.lastInsertRowid),
    peerAgentId: peer.agentId,
    peerDid: peer.did,
    peerPublicKey: peer.publicKey,
    trustLevel,
    status: "active",
    createdAt: now,
    expiresAt,
  };
}

function rowToPeerSession(row: Record<string, unknown>): PeerSession {
  return {
    id: Number(row.id),
    peerAgentId: row.peer_agent_id as string,
    peerDid: row.peer_did as string,
    peerPublicKey: row.peer_public_key as string,
    trustLevel: (row.trust_level as PeerSession["trustLevel"]) ?? "local",
    status: row.status as string,
    createdAt: row.created_at as string,
    expiresAt: row.expires_at as string,
  };
}

/** Convert a 32-byte Ed25519 public key hex to DER-encoded SPKI buffer */
function hexToDerSpki(hex: string): Buffer {
  const rawKey = Buffer.from(hex, "hex");
  // Ed25519 SubjectPublicKeyInfo DER prefix (OID 1.3.101.112)
  const spkiPrefix = Buffer.from("302a300506032b6570032100", "hex");
  return Buffer.concat([spkiPrefix, rawKey]);
}
