# Oracle Amigo - Implementation Specification

This document specifies the protocol-correct implementation of:
- A2A Protocol v1.0
- ANP (Agent Network Protocol) with DID:WBA + ECDHE
- Agent Skills (agentskills.io spec)
- OCI GenAI integration

## Target Architecture

```
+----------------------------------------------------------+
|  Agent (Oracle Amigo)                                    |
|                                                          |
|  +----------------+   +----------------+   +-----------+ |
|  | A2A v1.0       |   | ANP Layer      |   | Skills    | |
|  | Handler        |   |                |   | Registry  | |
|  | - message/send |   | - DID:WBA      |   |           | |
|  | - message/stream|  | - Handshake    |   | - SKILL.md| |
|  | - tasks/get    |   | - ECDHE (P-256)|   | - .agents | |
|  | - tasks/list   |   | - AES-GCM E2E  |   | - catalog | |
|  | - tasks/cancel |   |                |   |           | |
|  | - agentCard/*  |   |                |   |           | |
|  +----------------+   +----------------+   +-----------+ |
|         |                    |                   |       |
|  +--------------------------------------+                |
|  | OCI GenAI Client (LlmIntentExtractor,|                |
|  |                    LlmQueryRewriter) |                |
|  +--------------------------------------+                |
|         |                    |                   |       |
|  +----------------+   +----------------+   +-----------+ |
|  | Workflow       |   | Hybrid         |   | Storage   | |
|  | State Machine  |   | Retrieval      |   | Layer     | |
|  | (18 states)    |   | (FTS5 + vec0)  |   | (SQLite)  | |
|  +----------------+   +----------------+   +-----------+ |
+----------------------------------------------------------+
```

## Phase 1: A2A v1.0 Compliance

### 1.1 New Types (src/protocol/a2a/types.ts)

A2A v1.0 unified data model with proper JSON-RPC 2.0 envelopes.

### 1.2 AgentCard (src/protocol/a2a/AgentCard.ts)

- `supportedInterfaces[]` with `{ url, protocolBinding: "JSONRPC", protocolVersion: "1.0" }`
- `capabilities: { streaming: true, pushNotifications: false, stateTransitionHistory: true, extendedAgentCard: true }`
- `skills[]` with proper `id`, `name`, `description`, `tags`, `examples`, `inputModes`, `outputModes`

### 1.3 JSON-RPC Handler (src/protocol/a2a/A2AHandler.ts)

Methods:
- `message/send` - Creates/returns Task with Status
- `message/stream` - SSE stream of Status events
- `tasks/get` - Returns Task with History
- `tasks/list` - Paginated list with contextId/status filters
- `tasks/cancel` - Cancels a running task
- `agentCard/get` - Returns public AgentCard
- `agentCard/getExtended` - Authenticated extended card

### 1.4 LLM Wiring (src/oci/LlmProvider.ts)

- Real OCI GenAI client integration for IntentExtractor and QueryRewriter
- Structured JSON output with Zod schema validation
- Fallback to rule-based on OCI failure

## Phase 2: ANP with DID:WBA

### 2.1 DID:WBA Identity (src/security/anp/DidWba.ts)

- Generate `did:wba:<domain>:<port>:e1_<fingerprint>` DIDs
- RFC 7638 JWK thumbprint for `e1_` segment
- DID Document with `verificationMethod[]`, `authentication`, `keyAgreement`, `service[]`

### 2.2 ANP Handshake (src/security/anp/AnpProtocol.ts)

- `SourceHello`: identity + ECDHE pubkey (secp256r1) + nonce + signed proof
- `DestinationHello`: identity + ECDHE pubkey + selected protocol + signed proof
- `Finished`: key confirmation via HMAC-SHA256
- Derive shared secret via ECDH, derive AES-128-GCM session key via HKDF

### 2.3 E2E Encryption (src/security/anp/AnpCrypto.ts)

- AES-128-GCM with 12-byte IV, 16-byte auth tag
- sessionId-based key lookup
- Encrypt/decrypt helpers for Message frames

### 2.4 ANP Endpoints

- `GET /.well-known/did.json` - DID Document
- `POST /anp/handshake` - SourceHello/DestinationHello/Finished flow
- `POST /anp/message` - Encrypted message delivery

## Phase 3: Agent Skills

### 3.1 Skill Format (src/skills/SkillParser.ts)

- Parse `SKILL.md` YAML frontmatter (name, description, license, compatibility, metadata, allowed-tools)
- Validate constraints per agentskills.io spec
- Resolve `scripts/`, `references/`, `assets/`

### 3.2 Skill Registry (src/skills/SkillRegistry.ts)

- Scan `.agents/skills/` (project) and `~/.agents/skills/` (user)
- Three-tier progressive disclosure: catalog (metadata) -> instructions -> resources
- SHA-256 digest computation

### 3.3 Discovery Endpoint

- `GET /.well-known/agent-skills/index.json` with `$schema` and `skills[]`
- Support `skill-md` and `archive` types
- Each skill exposes `name`, `description`, `url`, `digest`

## Phase 4: Agent Registry

### 4.1 Local + Peer Registry (src/registry/AgentRegistry.ts)

- In-memory + SQLite cache of AgentCards
- Local agent registration on init
- Peer lookup by agentId / DID / URL

### 4.2 Well-known Endpoints

- `/.well-known/agent-card.json` (A2A)
- `/.well-known/did.json` (ANP)
- `/.well-known/agent-skills/index.json` (Skills)
- `/.well-known/agent-description.json` (ANP ADP)

## Phase 5: GitHub Push

- Initialize git (done)
- Add remote `https://github.com/SkandaGanesha1/Oracle-Amigo`
- Branch: main
- CI: GitHub Actions for typecheck + vitest
