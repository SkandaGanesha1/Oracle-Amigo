/**
 * Hardened ANP handshake adapter.
 *
 * Binds the canonical payload (peer/createdAt/expiresAt/offerId/fromDid/protocol/nonce)
 * to the signature, performs replay protection, validates timing, and resolves the
 * peer's DID to verify their public key.
 *
 * Session expiry is enforced on every `getPeerSession` lookup.
 */
import {
  createPrivateKey,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { getDb } from "../db/connection.js";
import { loadPrivateKeyPem, type LocalIdentity } from "./DeviceIdentity.js";
import {
  type AnpCanonicalFields,
  canonicalizeAnpPayload,
  signAnpPayload,
  validateAnpTiming,
  verifyAnpPayload,
} from "./AnpCanonicalPayload.js";
import { AnpReplayStore } from "./AnpReplayProtection.js";
import { DidCache, type DidResolution } from "./DidResolver.js";
import { calculateTrustLevel, type TrustLevel } from "./AnpTrustLevel.js";

export const ANP_HANDSHAKE_PROTOCOL = "anp/handshake/v1";

export type HandshakeOffer = {
  offerId: string;
  peer: string;
  nonce: string;
  createdAt: string;
  expiresAt: string;
  fromDid: string;
  protocol: string;
  signature: string;
};

export type HandshakeResponse = {
  responseId: string;
  offerId: string;
  peer: string;
  nonce: string;
  status: "accepted" | "rejected";
  createdAt: string;
  expiresAt: string;
  fromDid: string;
  protocol: string;
  signature: string;
};

export type PeerSession = {
  id: number;
  peerAgentId: string;
  peerDid: string;
  peerPublicKey: string;
  trustLevel: TrustLevel;
  status: string;
  createdAt: string;
  expiresAt: string;
};

export type HandshakeContext = {
  replayStore: AnpReplayStore;
  didCache: DidCache;
  defaultTtlSeconds: number;
  now: () => Date;
};

const DEFAULT_TTL_SECONDS = 60;

export function createHandshakeContext(options: Partial<HandshakeContext> = {}): HandshakeContext {
  return {
    replayStore: options.replayStore ?? new AnpReplayStore(),
    didCache: options.didCache ?? new DidCache(),
    defaultTtlSeconds: options.defaultTtlSeconds ?? 60 * 60,
    now: options.now ?? (() => new Date()),
  };
}

// ---------------- OFFER ----------------

export function createHandshakeOffer(
  identity: LocalIdentity,
  peer: string,
  ctx: HandshakeContext = createHandshakeContext(),
): HandshakeOffer {
  const now = ctx.now();
  const expiresAt = new Date(now.getTime() + ctx.defaultTtlSeconds * 1000);
  const fields: AnpCanonicalFields = {
    peer,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    offerId: randomUUID(),
    fromDid: identity.did,
    protocol: ANP_HANDSHAKE_PROTOCOL,
    nonce: randomBytes(32).toString("hex"),
  };
  const privPem = loadPrivateKeyPem(identity);
  const privKey = createPrivateKey(privPem);
  const signature = signAnpPayload(fields, privPem);
  return {
    offerId: fields.offerId,
    peer: fields.peer,
    nonce: fields.nonce,
    createdAt: fields.createdAt,
    expiresAt: fields.expiresAt,
    fromDid: fields.fromDid,
    protocol: fields.protocol,
    signature,
  };
}

export type OfferVerification = {
  valid: boolean;
  reason?: string;
  fields?: AnpCanonicalFields;
  resolution?: DidResolution | null;
};

/**
 * Verify a handshake offer: timing, signature, DID resolution.
 * Records the nonce in the replay store only when everything checks out.
 */
export async function verifyHandshakeOffer(
  offer: HandshakeOffer,
  publicKeyHex: string,
  ctx: HandshakeContext = createHandshakeContext(),
): Promise<OfferVerification> {
  const fields: AnpCanonicalFields = {
    peer: offer.peer,
    createdAt: offer.createdAt,
    expiresAt: offer.expiresAt,
    offerId: offer.offerId,
    fromDid: offer.fromDid,
    protocol: offer.protocol,
    nonce: offer.nonce,
  };
  if (fields.protocol !== ANP_HANDSHAKE_PROTOCOL) {
    return { valid: false, reason: "unknown_protocol" };
  }
  const timing = validateAnpTiming(fields, ctx.now());
  if (!timing.valid) return { valid: false, reason: `timing_${timing.reason}` };
  if (!verifyAnpPayload(fields, offer.signature, publicKeyHex)) {
    return { valid: false, reason: "bad_signature" };
  }
  const resolution = await ctx.didCache.resolve(offer.fromDid);
  if (!resolution) return { valid: false, reason: "did_unresolved" };
  if (resolution.publicKeyHex !== publicKeyHex) {
    return { valid: false, reason: "did_key_mismatch" };
  }
  if (!ctx.replayStore.checkAndRecord(offer.peer, offer.offerId, offer.nonce, ctx.now().getTime())) {
    return { valid: false, reason: "replayed" };
  }
  return { valid: true, fields, resolution };
}

// ---------------- RESPONSE ----------------

export function createHandshakeResponse(
  offer: HandshakeOffer,
  identity: LocalIdentity,
  ctx: HandshakeContext = createHandshakeContext(),
): HandshakeResponse {
  const now = ctx.now();
  const expiresAt = new Date(now.getTime() + ctx.defaultTtlSeconds * 1000);
  const responseId = randomUUID();
  const responseFields: AnpCanonicalFields = {
    peer: offer.peer,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    offerId: responseId,
    fromDid: identity.did,
    protocol: ANP_HANDSHAKE_PROTOCOL,
    nonce: offer.nonce,
  };
  const signature = signAnpPayload(responseFields, loadPrivateKeyPem(identity));
  return {
    responseId,
    offerId: offer.offerId,
    peer: offer.peer,
    nonce: offer.nonce,
    status: "accepted",
    createdAt: responseFields.createdAt,
    expiresAt: responseFields.expiresAt,
    fromDid: responseFields.fromDid,
    protocol: responseFields.protocol,
    signature,
  };
}

export type ResponseVerification = { valid: boolean; reason?: string };

export async function verifyHandshakeResponse(
  response: HandshakeResponse,
  publicKeyHex: string,
  ctx: HandshakeContext = createHandshakeContext(),
): Promise<ResponseVerification> {
  if (response.status !== "accepted") return { valid: false, reason: "not_accepted" };
  const fields: AnpCanonicalFields = {
    peer: response.peer,
    createdAt: response.createdAt,
    expiresAt: response.expiresAt,
    offerId: response.responseId,
    fromDid: response.fromDid,
    protocol: response.protocol,
    nonce: response.nonce,
  };
  if (fields.protocol !== ANP_HANDSHAKE_PROTOCOL) {
    return { valid: false, reason: "unknown_protocol" };
  }
  const timing = validateAnpTiming(fields, ctx.now());
  if (!timing.valid) return { valid: false, reason: `timing_${timing.reason}` };
  if (!verifyAnpPayload(fields, response.signature, publicKeyHex)) {
    return { valid: false, reason: "bad_signature" };
  }
  const resolution = await ctx.didCache.resolve(response.fromDid);
  if (!resolution) return { valid: false, reason: "did_unresolved" };
  if (resolution.publicKeyHex !== publicKeyHex) {
    return { valid: false, reason: "did_key_mismatch" };
  }
  if (!ctx.replayStore.checkAndRecord(fields.peer, response.responseId, response.nonce, ctx.now().getTime())) {
    return { valid: false, reason: "replayed" };
  }
  return { valid: true };
}

// ---------------- SESSION ----------------

export function createOrGetPeerSession(peer: {
  agentId: string;
  did: string;
  publicKey: string;
  trustLevel?: TrustLevel;
  isLoopback?: boolean;
  hasPriorSession?: boolean;
}, ctx: HandshakeContext = createHandshakeContext()): PeerSession {
  const db = getDb();
  const now = ctx.now();
  const expiresAt = new Date(now.getTime() + ctx.defaultTtlSeconds * 1000);
  const trustLevel = peer.trustLevel ?? calculateTrustLevel({
    did: peer.did,
    resolution: peer.did.startsWith("did:wba:")
      ? { method: "wba" }
      : peer.did.startsWith("did:key:")
        ? { method: "key" }
        : null,
    isLoopback: peer.isLoopback ?? false,
    hasPriorSession: peer.hasPriorSession ?? false,
  });

  const existing = db.prepare(
    "SELECT * FROM peer_sessions WHERE peer_agent_id = ? AND status = 'active' LIMIT 1"
  ).get(peer.agentId) as Record<string, unknown> | undefined;

  if (existing) {
    const sess = rowToPeerSession(existing);
    if (Date.parse(sess.expiresAt) > now.getTime()) return sess;
    // expired — mark and create a fresh one
    db.prepare("UPDATE peer_sessions SET status = 'expired' WHERE id = ?").run(sess.id);
  }

  const result = db.prepare(`
    INSERT INTO peer_sessions (peer_agent_id, peer_did, peer_public_key, trust_level, status, created_at, expires_at)
    VALUES (?, ?, ?, ?, 'active', ?, ?)
  `).run(peer.agentId, peer.did, peer.publicKey, trustLevel, now.toISOString(), expiresAt.toISOString());

  return {
    id: Number(result.lastInsertRowid),
    peerAgentId: peer.agentId,
    peerDid: peer.did,
    peerPublicKey: peer.publicKey,
    trustLevel,
    status: "active",
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
}

/** Enforce session expiry — returns the session only if it is still active. */
export function getActivePeerSession(peerAgentId: string, ctx: HandshakeContext = createHandshakeContext()): PeerSession | null {
  const db = getDb();
  const row = db.prepare(
    "SELECT * FROM peer_sessions WHERE peer_agent_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1"
  ).get(peerAgentId) as Record<string, unknown> | undefined;
  if (!row) return null;
  const session = rowToPeerSession(row);
  if (Date.parse(session.expiresAt) <= ctx.now().getTime()) {
    db.prepare("UPDATE peer_sessions SET status = 'expired' WHERE id = ?").run(session.id);
    return null;
  }
  return session;
}

function rowToPeerSession(row: Record<string, unknown>): PeerSession {
  return {
    id: Number(row.id),
    peerAgentId: row.peer_agent_id as string,
    peerDid: row.peer_did as string,
    peerPublicKey: row.peer_public_key as string,
    trustLevel: (row.trust_level as TrustLevel) ?? "untrusted",
    status: row.status as string,
    createdAt: row.created_at as string,
    expiresAt: row.expires_at as string,
  };
}

// Backwards-compat aliases used in places that still call verify* synchronously.
export function verifyHandshakeOfferSync(
  offer: HandshakeOffer,
  publicKeyHex: string,
): boolean {
  const fields: AnpCanonicalFields = {
    peer: offer.peer,
    createdAt: offer.createdAt,
    expiresAt: offer.expiresAt,
    offerId: offer.offerId,
    fromDid: offer.fromDid,
    protocol: offer.protocol,
    nonce: offer.nonce,
  };
  if (fields.protocol !== ANP_HANDSHAKE_PROTOCOL) return false;
  const timing = validateAnpTiming(fields);
  if (!timing.valid) return false;
  return verifyAnpPayload(fields, offer.signature, publicKeyHex);
}

export function verifyHandshakeResponseSync(
  response: HandshakeResponse,
  publicKeyHex: string,
): boolean {
  if (response.status !== "accepted") return false;
  const fields: AnpCanonicalFields = {
    peer: response.peer,
    createdAt: response.createdAt,
    expiresAt: response.expiresAt,
    offerId: response.responseId,
    fromDid: response.fromDid,
    protocol: response.protocol,
    nonce: response.nonce,
  };
  if (fields.protocol !== ANP_HANDSHAKE_PROTOCOL) return false;
  const timing = validateAnpTiming(fields);
  if (!timing.valid) return false;
  return verifyAnpPayload(fields, response.signature, publicKeyHex);
}

// Re-export canonicalize helper for tests.
export { canonicalizeAnpPayload };
