---
id: anp-handshake
name: ANP Handshake
description: Establish an encrypted peer-to-peer channel using DID:WBA identity, ECDHE key exchange (secp256r1), and AES-128-GCM session keys.
version: 0.1.0
tags: [anp, did:wba, ecdhe, handshake, encrypted-channel]
examples: ["establish encrypted channel with peer", "negotiate session key with 127.0.0.1:3499"]
inputModes: [application/json]
outputModes: [application/json]
---

# ANP Handshake

Performs a 3-message ANP handshake:

1. **SourceHello** — Alice sends her DID, Ed25519 public key, ECDHE public key, and nonce
2. **DestinationHello** — Bob responds with his DID, public key, ECDHE public key, and nonce
3. **Finished** — Alice encrypts the shared secretKeyId under the derived session key as proof

## Cryptography

- Identity: Ed25519 (raw 32-byte key, JWK thumbprint RFC 7638)
- Key exchange: ECDHE on secp256r1 / prime256v1
- KDF: HKDF-SHA256
- Cipher: AES-128-GCM
- Signatures: Ed25519 over canonicalized message (no explicit hash)

The derived session key can be used for subsequent encrypted ANP messages.
