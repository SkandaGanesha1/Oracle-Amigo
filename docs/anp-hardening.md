# ANP Hardening

This document describes the ANP-style identity and handshake hardening currently implemented in Oracle Amigo.

## Implemented

- Local DID/keypair identity for agent handshakes.
- Canonical full-payload signing for handshake offers and responses.
- Ed25519 verification over canonical JSON, not nonce-only signatures.
- `expires_at` and `created_at` validation with bounded clock skew.
- Replay protection through stored `(peer, offer_id, nonce)` tuples.
- DID/public-key verification for supported DID resolver paths.
- Peer session persistence with `peer_agent_id`, `peer_agent_instance_id`, `peer_did`, `peer_public_key`, `trust_level`, `session_id`/row id, `created_at`, and `expires_at`.
- DID-WBA bootstrap resolution for `did:wba:<host>:ed25519:<fingerprint>` and `did:wba:<host>:<port>:ed25519:<fingerprint>` through `/.well-known/did.json`.

## Not Yet Implemented

- Full ANP decentralized discovery.
- Production DID-WBA resolver behavior for open-network use.
- Full end-to-end ANP messaging across arbitrary peers.
- Marketplace-style open network participation.

## Signed Offer Payload

The canonical offer payload is:

```json
{
  "protocol": "anp-handshake-v1",
  "offer_id": "...",
  "from_agent_id": "...",
  "from_agent_instance_id": "...",
  "from_did": "...",
  "to_peer": "...",
  "nonce": "...",
  "created_at": "...",
  "expires_at": "..."
}
```

`canonicalizeAnpPayload(payload)` emits deterministic canonical JSON with sorted object keys and no insignificant whitespace. `signAnpPayload()` and `verifyAnpPayload()` operate over that canonical JSON string.

## Verification Rules

`verifyHandshakeOffer()` checks:

- `protocol` is `anp-handshake-v1`.
- `created_at` is not unreasonably in the future.
- `expires_at` has not expired and is after `created_at`.
- The Ed25519 signature verifies against the full canonical payload.
- The DID resolves to the expected public key.
- The `(to_peer, offer_id, nonce)` tuple has not already been used.

Every signed field is security-sensitive. Tests mutate `offer_id`, `from_agent_id`, `from_agent_instance_id`, `from_did`, `to_peer`, `nonce`, `created_at`, `expires_at`, and `protocol`; each mutation must fail verification.

## Session Expiry

`createOrGetPeerSession()` writes active peer sessions with an expiry timestamp. `getActivePeerSession(peerAgentId)` is the safe read path: it returns only unexpired active sessions and marks expired sessions as `expired`.

## Compatibility Notes

The HTTP handshake endpoints still expose camelCase aliases such as `offerId`, `createdAt`, and `fromDid` for older local callers. Those aliases are not the signed material. The signed payload uses the snake_case fields listed above.

Regression tests assert that mutating camelCase aliases does not affect signature verification when the signed snake_case fields are unchanged, while mutating any snake_case signed field fails verification.
