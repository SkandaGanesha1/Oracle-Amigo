# Research Summary

## Package Versions Used

| Package | Version | Purpose |
|---------|---------|---------|
| Node.js | ≥24 | Runtime with built-in `node:sqlite` |
| Fastify | 5.3.3 | HTTP server |
| React | 19.2.6 | UI framework |
| Vite | 7.3.3 | UI build tool |
| Vitest | 3.1.4 | Test runner |
| Zod | 3.25.36 | Schema validation |
| sqlite-vec | 0.1.9 | SQLite vector extension |
| @a2a-js/sdk | 0.3.13 | A2A protocol types and client SDK |

## A2A SDK

- npm package: `@a2a-js/sdk` v0.3.x
- Source: https://github.com/a2aproject/a2a-js
- Exports TypeScript types for AgentCard, Task, Message, Part, Artifact
- Main entry exports: `AGENT_CARD_PATH`, `Extensions`, `HTTP_EXTENSION_HEADER`
- Has subpath exports for `@a2a-js/sdk/client` and `@a2a-js/sdk/server`
- Implements JSON-RPC based A2A protocol with HTTP and gRPC transport
- **Used for**: Type definitions only. The actual A2A endpoint handlers are implemented in `src/server.ts` since the SDK's server integration is Express/Protobuf-specific.

## ANP (Agent Network Protocol)

- Source: https://github.com/agent-network-protocol/AgentNetworkProtocol
- No stable JS SDK exists
- **Implementation scope**: Isolated adapter following ANP concepts:
  - Ed25519 keypair generation (node:crypto)
  - DID:key identifier format
  - Signed nonce challenge/response handshake
  - Peer session management
- **Not implemented (future)**: Decentralized discovery, relay routing, secure envelope serialization

## sqlite-vec

- npm package: `sqlite-vec` v0.1.9
- Source: https://github.com/asg017/sqlite-vec
- Loads as extension into Node.js built-in `DatabaseSync`
- Provides `vec0` virtual table type for float vector storage and KNN search
- **Used for**: File embeddings (384-dim), memory embeddings, episodic embeddings
- Vector dimension: 384 (TODO: swap stub FNV-1a embedding for @xenova/transformers all-MiniLM-L6-v2)

## Windows Notifications

- API: Microsoft.Windows.AppNotifications
- Package: Microsoft.WindowsAppSDK
- Framework: .NET 8, target `net8.0-windows10.0.19041.0`
- Bridge architecture: Separate .NET process communicating with local agent over HTTP
- Toast XML supports text inputs and action buttons
- Fallback to in-app approval if bridge unavailable
