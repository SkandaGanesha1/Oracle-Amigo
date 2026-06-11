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

export const ANP_HANDSHAKE_PROTOCOL = "anp-handshake-v1";

export type HandshakeOffer = {
  protocol: string;
  offer_id: string;
  from_agent_id: string;
  from_agent_instance_id: string;
  from_did: string;
  to_peer: string;
  created_at: string;
  expires_at: string;
  nonce: string;
  signature: string;
};

export type HandshakeResponse = {
  protocol: string;
  response_id: string;
  offer_id: string;
  from_agent_id: string;
  from_agent_instance_id: string;
  from_did: string;
  to_peer: string;
  created_at: string;
  expires_at: string;
  nonce: string;
  status: "accepted" | "rejected";
  signature: string;
};

export type PeerSession = {
  id: number;
  peerAgentId: string;
  peerAgentInstanceId: string;
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
    protocol: ANP_HANDSHAKE_PROTOCOL,
    offer_id: randomUUID(),
    from_agent_id: identity.agentId,
    from_agent_instance_id: identity.agentId,
    from_did: identity.did,
    to_peer: peer,
    nonce: randomBytes(32).toString("hex"),
    created_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
  };
  const privPem = loadPrivateKeyPem(identity);
  const signature = signAnpPayload(fields, privPem);
  return {
    protocol: fields.protocol,
    offer_id: fields.offer_id,
    from_agent_id: fields.from_agent_id,
    from_agent_instance_id: fields.from_agent_instance_id,
    from_did: fields.from_did,
    to_peer: fields.to_peer,
    nonce: fields.nonce,
    created_at: fields.created_at,
    expires_at: fields.expires_at,
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
    protocol: offer.protocol,
    offer_id: offer.offer_id ?? (offer as HandshakeOffer & { offerId?: string }).offerId,
    from_agent_id: offer.from_agent_id,
    from_agent_instance_id: offer.from_agent_instance_id,
    from_did: offer.from_did ?? (offer as HandshakeOffer & { fromDid?: string }).fromDid,
    to_peer: offer.to_peer ?? (offer as HandshakeOffer & { peer?: string }).peer,
    nonce: offer.nonce,
    created_at: offer.created_at ?? (offer as HandshakeOffer & { createdAt?: string }).createdAt,
    expires_at: offer.expires_at ?? (offer as HandshakeOffer & { expiresAt?: string }).expiresAt,
  };
  if (fields.protocol !== ANP_HANDSHAKE_PROTOCOL) {
    return { valid: false, reason: "unknown_protocol" };
  }
  const timing = validateAnpTiming(fields, ctx.now());
  if (!timing.valid) return { valid: false, reason: `timing_${timing.reason}` };
  if (!verifyAnpPayload(fields, offer.signature, publicKeyHex)) {
    return { valid: false, reason: "bad_signature" };
  }
  const resolution = await ctx.didCache.resolve(fields.from_did);
  if (!resolution) return { valid: false, reason: "did_unresolved" };
  if (resolution.publicKeyHex !== publicKeyHex) {
    return { valid: false, reason: "did_key_mismatch" };
  }
  if (!ctx.replayStore.checkAndRecord(fields.to_peer, fields.offer_id, fields.nonce, ctx.now().getTime())) {
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
    protocol: ANP_HANDSHAKE_PROTOCOL,
    offer_id: responseId,
    from_agent_id: identity.agentId,
    from_agent_instance_id: identity.agentId,
    from_did: identity.did,
    to_peer: offer.to_peer ?? (offer as HandshakeOffer & { peer?: string }).peer,
    nonce: offer.nonce,
    created_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
  };
  const signature = signAnpPayload(responseFields, loadPrivateKeyPem(identity));
  return {
    protocol: responseFields.protocol,
    response_id: responseId,
    offer_id: offer.offer_id ?? (offer as HandshakeOffer & { offerId?: string }).offerId,
    from_agent_id: responseFields.from_agent_id,
    from_agent_instance_id: responseFields.from_agent_instance_id,
    from_did: responseFields.from_did,
    to_peer: responseFields.to_peer,
    created_at: responseFields.created_at,
    expires_at: responseFields.expires_at,
    nonce: responseFields.nonce,
    status: "accepted",
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
    protocol: response.protocol,
    offer_id: (response as HandshakeResponse & { responseId?: string }).responseId ?? response.response_id,
    from_agent_id: response.from_agent_id,
    from_agent_instance_id: response.from_agent_instance_id,
    from_did: response.from_did ?? (response as HandshakeResponse & { fromDid?: string }).fromDid,
    to_peer: response.to_peer ?? (response as HandshakeResponse & { peer?: string }).peer,
    nonce: response.nonce,
    created_at: response.created_at ?? (response as HandshakeResponse & { createdAt?: string }).createdAt,
    expires_at: response.expires_at ?? (response as HandshakeResponse & { expiresAt?: string }).expiresAt,
  };
  if (fields.protocol !== ANP_HANDSHAKE_PROTOCOL) {
    return { valid: false, reason: "unknown_protocol" };
  }
  const timing = validateAnpTiming(fields, ctx.now());
  if (!timing.valid) return { valid: false, reason: `timing_${timing.reason}` };
  if (!verifyAnpPayload(fields, response.signature, publicKeyHex)) {
    return { valid: false, reason: "bad_signature" };
  }
  const resolution = await ctx.didCache.resolve(fields.from_did);
  if (!resolution) return { valid: false, reason: "did_unresolved" };
  if (resolution.publicKeyHex !== publicKeyHex) {
    return { valid: false, reason: "did_key_mismatch" };
  }
  if (!ctx.replayStore.checkAndRecord(fields.to_peer, fields.offer_id, response.nonce, ctx.now().getTime())) {
    return { valid: false, reason: "replayed" };
  }
  return { valid: true };
}

// ---------------- SESSION ----------------

export function createOrGetPeerSession(peer: {
  agentId: string;
  agentInstanceId?: string;
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

  const agentInstanceId = peer.agentInstanceId ?? peer.agentId;
  const existing = db.prepare(
    "SELECT * FROM peer_sessions WHERE peer_agent_id = ? AND peer_agent_instance_id = ? AND status = 'active' LIMIT 1"
  ).get(peer.agentId, agentInstanceId) as Record<string, unknown> | undefined;

  if (existing) {
    const sess = rowToPeerSession(existing);
    if (Date.parse(sess.expiresAt) > now.getTime()) return sess;
    // expired — mark and create a fresh one
    db.prepare("UPDATE peer_sessions SET status = 'expired' WHERE id = ?").run(sess.id);
  }

  const result = db.prepare(`
    INSERT INTO peer_sessions (peer_agent_id, peer_agent_instance_id, peer_did, peer_public_key, trust_level, status, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
  `).run(peer.agentId, agentInstanceId, peer.did, peer.publicKey, trustLevel, now.toISOString(), expiresAt.toISOString());

  return {
    id: Number(result.lastInsertRowid),
    peerAgentId: peer.agentId,
    peerAgentInstanceId: agentInstanceId,
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
    peerAgentInstanceId: (row.peer_agent_instance_id as string | undefined) ?? (row.peer_agent_id as string),
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
    protocol: offer.protocol,
    offer_id: offer.offer_id ?? (offer as HandshakeOffer & { offerId?: string }).offerId,
    from_agent_id: offer.from_agent_id,
    from_agent_instance_id: offer.from_agent_instance_id,
    from_did: offer.from_did ?? (offer as HandshakeOffer & { fromDid?: string }).fromDid,
    to_peer: offer.to_peer ?? (offer as HandshakeOffer & { peer?: string }).peer,
    nonce: offer.nonce,
    created_at: offer.created_at ?? (offer as HandshakeOffer & { createdAt?: string }).createdAt,
    expires_at: offer.expires_at ?? (offer as HandshakeOffer & { expiresAt?: string }).expiresAt,
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
    protocol: response.protocol,
    offer_id: (response as HandshakeResponse & { responseId?: string }).responseId ?? response.response_id,
    from_agent_id: response.from_agent_id,
    from_agent_instance_id: response.from_agent_instance_id,
    from_did: response.from_did ?? (response as HandshakeResponse & { fromDid?: string }).fromDid,
    to_peer: response.to_peer ?? (response as HandshakeResponse & { peer?: string }).peer,
    nonce: response.nonce,
    created_at: response.created_at ?? (response as HandshakeResponse & { createdAt?: string }).createdAt,
    expires_at: response.expires_at ?? (response as HandshakeResponse & { expiresAt?: string }).expiresAt,
  };
  if (fields.protocol !== ANP_HANDSHAKE_PROTOCOL) return false;
  const timing = validateAnpTiming(fields);
  if (!timing.valid) return false;
  return verifyAnpPayload(fields, response.signature, publicKeyHex);
}

// Re-export canonicalize helper for tests.
export { canonicalizeAnpPayload };
