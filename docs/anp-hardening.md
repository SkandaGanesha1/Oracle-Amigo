# ANP Hardening

This document describes the security hardening applied to the ANP handshake
layer in Oracle Amigo. The primitives are designed to defend against the
common attack classes listed below.

## Threat Model

| Threat | Defense |
| --- | --- |
| **Signature replay** (attacker re-sends a captured offer) | `AnpReplayStore` records `(peer, offerId, nonce)`; second submission is rejected. |
| **Tampered field substitution** (attacker swaps peer/offerId/etc. but keeps the original signature) | Canonical payload binds all 7 fields (peer, createdAt, expiresAt, offerId, fromDid, protocol, nonce) to the signature. |
| **Expired payload** (attacker replays a very old offer that still verifies cryptographically) | `validateAnpTiming` rejects payloads where `expiresAt < now - 30s` or `createdAt > now + 30s`. |
| **DID spoofing** (attacker claims a DID they don't own) | `DidResolver` resolves the DID and compares the resolved public key to the one used in the signature; mismatch is rejected. |
| **Trust assumption mismatch** (loopback peer treated as if it were a remote, or vice versa) | `calculateTrustLevel` derives trust from peer address (loopback vs public), DID method, and prior session history. |
| **Session staleness** (old session reused after the original peer has rotated) | `getActivePeerSession` checks `expiresAt`; expired sessions are marked and a fresh one is created. |

## Primitives

### `AnpCanonicalPayload` (`src/security/AnpCanonicalPayload.ts`)

- `AnpCanonicalFields` — the seven fields that bind to the signature: `peer`, `createdAt`, `expiresAt`, `offerId`, `fromDid`, `protocol`, `nonce`.
- `canonicalizeAnpPayload(fields)` — produces a deterministic string. Each field is prefixed with its UTF-8 byte length as a 4-digit hex value, then a colon, then the field bytes. This prevents field-boundary confusion attacks.
- `signAnpPayload(fields, privateKeyPem)` / `verifyAnpPayload(fields, signatureHex, publicKey)` — Ed25519 sign/verify over the canonical string.
- `validateAnpTiming(fields, now?, skewSeconds?)` — checks `createdAt`/`expiresAt` are valid and in range. Default skew is 30s.

### `AnpReplayStore` (`src/security/AnpReplayProtection.ts`)

- In-memory LRU of seen nonces keyed by `peer|offerId|nonce`.
- Bounded to `maxEntries` (default 50,000) with oldest-first eviction.
- TTL-based pruning (default 24h).
- `checkAndRecord(peer, offerId, nonce, now?)` returns `true` if new, `false` if replayed.

### `DidResolver` (`src/security/DidResolver.ts`)

- `resolveDid(did, options)` returns a `DidResolution` or `null`.
- `did:key:z...` — self-resolving (no I/O). Multibase base58btc, multicodec `0xed 0x01` for Ed25519.
- `did:wba:host[:port]:ed25519:fingerprint` — fetches `https://host[:port]/.well-known/did.json` and checks the `did` + `publicKey` match.
- `DidCache` is a thin TTL cache (default 1h) on top.

### `AnpTrustLevel` (`src/security/AnpTrustLevel.ts`)

- Trust levels (high to low): `local` > `loopback` > `verified` > `untrusted`.
- `calculateTrustLevel(inputs)` — derives level from:
  1. Pinned override (always wins).
  2. Loopback address → `loopback`.
  3. Did method + prior session → `verified`.
  4. Otherwise → `untrusted`.
- `isLoopbackAddress(host)` — heuristic loopback detection (127.0.0.0/8, `localhost`, `*.localhost`).
- `isTrustAtLeast(actual, minimum)` — comparison helper.

## Handshake Flow

```
Alice                                                    Bob
  |   createHandshakeOffer(identity, "bob")               |
  |     → builds canonical payload                        |
  |     → signs with Alice's private key                  |
  |     → returns { offerId, peer, nonce,                  |
  |                 createdAt, expiresAt, fromDid,         |
  |                 protocol, signature }                  |
  |                                                      |
  | --- POST /anp/handshake/offer  --------------------> |
  |                                                      |
  |                  Bob: verifyHandshakeOffer(offer, AlicePublicKey)
  |                       1. validateAnpTiming            |
  |                       2. verifyAnpPayload             |
  |                       3. ctx.didCache.resolve(Alice.did)
  |                       4. compare resolved key to AlicePublicKey
  |                       5. replayStore.checkAndRecord  |
  |                                                      |
  |                       createHandshakeResponse(offer)  |
  |                         → signs with Bob's private key|
  | <------ POST /anp/handshake/response  --------------- |
  |                                                      |
  | Alice: verifyHandshakeResponse(response, BobPublicKey)
  |        ... (same checks)                             |
```

## Session Expiry

`createOrGetPeerSession` writes a session with `expires_at = now + defaultTtlSeconds` (default 1h). `getActivePeerSession(peerAgentId)` is the only safe read path — it checks expiry on every call and marks expired sessions as `expired` in the database.

## Migration Notes

- The previous `AnpHandshakeAdapter` only signed the nonce. The new adapter signs the canonical payload, which is a strict superset.
- The wire shape of the offer/response objects has gained three new fields: `expiresAt`, `fromDid`, `protocol`. Existing clients that send a request body missing these fields will be rejected (HTTP 400). The `/anp/handshake/offer` endpoint returns the new shape.
- `verifyHandshakeOffer` and `verifyHandshakeResponse` are now async. The original sync behavior is preserved under the `verifyHandshakeOfferSync` and `verifyHandshakeResponseSync` aliases for callers that don't need DID resolution or replay protection.
- `TrustLevel` is now `local | loopback | verified | untrusted` (was `local | loopback | future`).
- All 236 tests pass after the upgrade.
