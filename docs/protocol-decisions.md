# Protocol Decisions

## Why A2A for Task Lifecycle

- A2A (Agent-to-Agent) is a Google-led open standard for inter-agent task communication
- Provides well-defined Task, Message, Part, Artifact models
- `@a2a-js/sdk` v0.3.x provides TypeScript types and client/server infrastructure
- Our workflow state machine maps directly to A2A task states
- A2A JSON-RPC endpoint is exposed at `POST /a2a/v1`

## What's A2A Compliant Now

- Agent Card served at `GET /.well-known/agent-card.json`
- Task creation via `POST /a2a/v1`
- Task status retrieval via `GET /a2a/tasks/:taskId`
- Task state mapping from internal states to A2A states (submitted, working, input-required, completed, rejected, failed)
- Message parts with text content

## What's Future A2A

- `SendStreamingMessage` for real-time updates (using SSE as interim solution)
- `TaskPushNotificationConfig` for push notifications
- gRPC transport
- Full JSON-RPC compliance with request batching
- Authenticated extended agent card

## Why ANP Is an Isolated Adapter

- ANP (Agent Network Protocol) is a proposed standard with no stable JS SDK
- We implement an isolated adapter in `src/security/` following ANP concepts:
  - Ed25519 keypair → DID:key identity
  - Signed nonce handshake
  - Peer session management
- Fully documented gap for future production remote discovery

## ANP Compliance Now

- Agent identity keypair generation and persistence
- DID:key identifier (`did:key:z...`)
- Signed handshake offer/response with Ed25519
- Tamper detection via signature verification
- Peer session storage

## ANP Not Implemented (Future)

- Decentralized peer discovery
- Relay/routing layer
- Secure envelope serialization
- Remote endpoint resolution

## Why sqlite-vec for Local Memory/Search

- No external dependencies beyond SQLite
- Built-in vec0 virtual table for KNN vector search
- FTS5 for lexical search, same database
- Deterministic stub embedding avoids model download
- Clear interface boundary for swapping to @xenova/transformers later
