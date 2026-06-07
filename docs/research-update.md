# Research Update: Oracle Amigo Two-Device Architecture

## 1. Current Repo Architecture

### 1.1 Overall Structure
The repository is a **local-first personal agent POC** with a single-process Fastify server (`src/server.ts`) that runs on `127.0.0.1:3399`. It serves both the React UI and the agent API endpoints. All state is stored in a local SQLite database (`node:sqlite` with WAL mode) with `sqlite-vec` extension for vector search.

### 1.2 Core Components

| Component | Location | Description |
|-----------|----------|-------------|
| HTTP Server | `src/server.ts` | Fastify server with all endpoints |
| Database | `src/db/connection.ts` | SQLite + sqlite-vec with multi-tenant partition keys |
| Schema | `src/db/schema.sql` | 18 tables including FTS5, vec0, audit chain |
| A2A Protocol | `src/protocol/a2a/` | v0.3.0 types, handler, agent card |
| ANP Protocol | `src/security/anp/` | Handshake, crypto, meta-protocol, ADP, discovery, messaging, AP2 |
| ANP Adapter | `src/security/AnpHandshakeAdapter.ts` | Simple nonce-signing handshake (not canonical) |
| Memory | `src/memory/` | Short-term, Long-term, Episodic with tenant isolation |
| File Search | `src/retrieval/` | Hybrid FTS5 + vec0 KNN + RRF + MMR |
| File Indexer | `src/retrieval/FileIndexer.ts` | Walks roots, embeds, stores in vec0 |
| Storage | `src/storage/AgenticStorage.ts` | Staging/approved/inbox/sent/temp folders |
| Approvals | `src/protocol/PersonalAgentProtocol.ts` | Approval creation, decision, audit |
| Audit | `src/security/AuditHashChain.ts` | Tamper-evident hash chain |
| Device Identity | `src/security/DeviceIdentity.ts` | Ed25519 keypairs, DID:key, local profiles |
| Notification Bridge | `apps/notification-bridge-windows/` | .NET 8 Windows Toast bridge |
| Loopback Harness | `src/loopback/LoopbackTestHarness.ts` | Two-agent test harness |

### 1.3 Data Flow (Single-Device)
1. User types in UI → `POST /chat/messages`
2. `IntentExtractor` classifies intent
3. If file request: task created, state machine transitions
4. `HybridRetrievalPipeline.search()` → FTS5 + vec0 KNN + RRF + MMR
5. Candidates shown in ApprovalCard
6. User approves → file staged → SHA-256 verified → promoted
7. Transfer receipt created, audit event appended

### 1.4 Loopback Mode
- Two agent instances on ports 3399 and 3400
- Separate SQLite databases and storage folders per agent
- ANP handshake establishes peer session
- A2A task messages flow via HTTP between agents

---

## 2. Current A2A Implementation Status

### 2.1 What Exists (A2A v0.3.0)
- **AgentCard**: `protocolVersion: "0.3.0"`, `preferredTransport`, `additionalInterfaces`, `securitySchemes`, `supportsAuthenticatedExtendedCard`
- **11 JSON-RPC Methods**:
  - `message/send`, `message/stream`
  - `tasks/get`, `tasks/list`, `tasks/cancel`, `tasks/resubscribe`
  - `tasks/pushNotificationConfig/{set,get,list,delete}`
  - `agent/getAuthenticatedExtendedCard`
- **Error Codes**: `PUSH_NOTIFICATION_NOT_SUPPORTED (-32003)`, `CONTENT_TYPE_NOT_SUPPORTED (-32005)`, `AUTHENTICATED_EXTENDED_CARD_NOT_CONFIGURED (-32007)`
- **Streaming Events**: `TaskStatusUpdateEvent`, `TaskArtifactUpdateEvent`
- **Types**: `TextPart`, `FilePart`, `DataPart`, `FileWithBytes`, `FileWithUri`, `Message`, `Task`, `Artifact`, `AgentCard`, `AgentSkill`, `AgentExtension`, `SecurityScheme`

### 2.2 What A2A v1.0 Adds (2026-03-12 release)
- **`kind` discriminator removed** — use member-based polymorphism (breaking)
- **Enum values changed**: `kebab-case` → `SCREAMING_SNAKE_CASE` (e.g., `submitted` → `TASK_STATE_SUBMITTED`)
- **`supportedInterfaces` field** (not `additionalInterfaces`)
- **JWS-signed Agent Cards** (RFC 7515)
- **Multi-tenancy**: `tenant` field in requests
- **HTTP+JSON binding preferred** (JSON-RPC is fallback)
- **OAuth 2.0 Device Code flow** (RFC 8628) + PKCE
- **A2A-Version, A2A-Extensions headers**
- **Media type**: `application/a2a+json`
- **Cursor-based pagination** for task listing
- **Task IDs server-generated**
- **ISO 8601 millisecond timestamps**
- **Proto as canonical source of truth** (`a2a.proto`)

### 2.3 A2A v1 Endpoint URLs (HTTP+JSON)
| Method | v0.3 | v1 |
|--------|------|-----|
| Send Message | `message/send` (JSON-RPC) | `POST /v1/message:send` |
| Stream | `message/stream` (SSE) | `POST /v1/message:stream` |
| Get Task | `tasks/get` (JSON-RPC) | `GET /v1/tasks/{id}` |
| List Tasks | `tasks/list` (JSON-RPC) | `GET /v1/tasks` |
| Cancel | `tasks/cancel` (JSON-RPC) | `POST /v1/tasks/{id}:cancel` |
| Subscribe | `tasks/resubscribe` (JSON-RPC) | `GET /v1/tasks/{id}:subscribe` |
| Push Config | `tasks/pushNotificationConfig/*` | `POST/GET/DELETE /v1/tasks/{id}/pushNotificationConfigs` |
| Agent Card | `agent/getAuthenticatedExtendedCard` | `GET /v1/agent/authenticatedExtendedCard` |
| Agent Card (public) | `/.well-known/agent-card.json` | `/.well-known/agent-card.json` |

### 2.4 SDK Usage
- Uses `@a2a-js/sdk` v0.3.13 for **type definitions only**
- Actual handlers implemented in `src/server.ts` because SDK server integration is Express/Protobuf-specific

---

## 3. Current ANP Implementation Status

### 3.1 What Exists (ANP-Style Local Handshake)
- **Identity**: Ed25519 keypairs, DID:key format (`src/security/DeviceIdentity.ts`)
- **Handshake** (`src/security/AnpHandshakeAdapter.ts`):
  - `createHandshakeOffer()`: signs nonce only (NOT canonical)
  - `verifyHandshakeOffer()`: verifies nonce signature
  - `createHandshakeResponse()`: signs offerId:nonce
  - `verifyHandshakeResponse()`: verifies response signature
  - Peer session management in `peer_sessions` table
- **Meta-Protocol** (`src/security/anp/AnpMetaProtocol.ts`): Capability negotiation, 12 capabilities, 9 application protocols
- **ADP** (`src/security/anp/AgentDescriptionProtocol.ts`): JSON-LD agent descriptions at `/.well-known/agent-description.json`
- **Discovery** (`src/security/anp/AgentDiscoveryProtocol.ts`): Capability scoring, WNS handle conversion
- **Messaging** (`src/security/anp/MessagingProtocol.ts`): E2E encrypted/signed envelopes, message threads
- **AP2 Payments** (`src/security/anp/Ap2PaymentProtocol.ts`): Intent → authorize → settle lifecycle
- **Crypto** (`src/security/anp/AnpCrypto.ts`): ECDHE (secp256r1), HKDF-SHA256, AES-128-GCM

### 3.2 ANP Spec Reference
- [IETF draft-zyyhl-agent-networks-framework-00](https://github.com/agent-network-protocol/AgentNetworkProtocol/blob/main/standard/draft-zyyhl-agent-networks-framework-00.md)
- Three-layer architecture: Identity (DID:WBA) + Meta-Protocol + Application Protocol
- `did:wba` method: `did:wba:host:port:ed25519:<fingerprint>` (V0.2)
- HTTP Message Signatures (RFC 9421) for request signing
- Content-Digest (RFC 9530) for body integrity
- WNS handles: human-readable agent identifiers
- Capability negotiation via structured meta-protocol
- E2E encryption via ECDHE + AES-128-GCM

### 3.3 Critical Gaps (Not Production-Ready)
- **Handshake signs only nonce**, not canonical full payload (peer, createdAt, expiresAt, offerId, from_did, protocol not bound)
- **No replay protection** (nonce can be reused)
- **No expiry validation** on offers
- **No DID/public key resolution** from registry (only local)
- **No trust level calculation** based on verification
- **No session expiry** enforcement
- **Loopback works** but not hardened for cross-device

### 3.4 ANP Compliance Scope
| Component | Status | Notes |
|-----------|--------|-------|
| Identity (DID:WBA) | ✅ Partial | DID:key used, not DID:WBA |
| Meta-Protocol | ✅ Implemented | Capability negotiation works |
| ADP | ✅ Implemented | JSON-LD at `/.well-known/agent-description.json` |
| Discovery | ✅ Implemented | Scoring + WNS handle conversion |
| E2E Messaging | ✅ Implemented | DIDComm-style envelopes |
| AP2 Payments | ✅ Implemented | Intent lifecycle |
| **Hardened Handshake** | ❌ **Missing** | Canonical payload, replay, expiry, DID resolution |

---

## 4. Latest A2A Spec Differences That Matter

### A2A v0.3.0 (Current) vs A2A v1.0 (Target)

| Aspect | v0.3.0 | v1 |
|--------|--------|-----|
| Agent Card Field | `additionalInterfaces` | `supportedInterfaces` |
| Protocol Version | `"0.3.0"` | `"1.0"` |
| Transport | `preferredTransport` | Part of `supportedInterfaces` |
| Task States | `submitted`, `working`, `input-required`, etc. | `TASK_STATE_SUBMITTED`, `TASK_STATE_WORKING`, etc. |
| Message Send | `message/send` (JSON-RPC method) | `POST /v1/message:send` |
| Task Get | `tasks/get` (JSON-RPC method) | `GET /v1/tasks/{id}` |
| Task Cancel | `tasks/cancel` (JSON-RPC method) | `POST /v1/tasks/{id}:cancel` |
| Streaming | `message/stream` (JSON-RPC method) | `POST /v1/message:stream` |
| Push Notifications | `tasks/pushNotificationConfig/*` | `POST/GET/DELETE /v1/tasks/{id}/pushNotificationConfigs` |
| Agent Card (auth) | `agent/getAuthenticatedExtendedCard` | `GET /v1/agent/authenticatedExtendedCard` |
| `kind` discriminator | Required | **Removed** (breaking) |
| Member-based polymorphism | No | Yes |
| JWS signing | No | Yes (RFC 7515) |
| Multi-tenancy | No | `tenant` field in requests |
| Binding | JSON-RPC only | HTTP+JSON preferred, JSON-RPC fallback |
| Pagination | Offset-based | Cursor-based |
| Task IDs | Client-supplied | Server-generated |
| Timestamp precision | seconds | milliseconds |
| Media type | `application/json` | `application/a2a+json` |
| Version header | None | `A2A-Version` header |
| Extensions header | None | `A2A-Extensions` header |
| Canonical data model | ad-hoc | Proto file (`a2a.proto`) |

### Key Implementation Decision
- **Keep v0.3.0 working** for local/loopback mode (existing tests)
- **Add full A2A v1 implementation** as the primary path going forward
- **Provide v1↔v0.3 compatibility adapter** for migration
- **Publish v1 card at** `/.well-known/agent-card.json`
- **Keep v0.3 card at** `/.well-known/agent-card.v0.3.json` for backward compatibility

---

## 5. sqlite-vec Usage and Version Notes

### 5.1 Current Version
- `sqlite-vec` **v0.1.9** (pre-v1, API unstable)
- Loaded as extension into Node.js built-in `DatabaseSync`
- Provides `vec0` virtual table type for float vector storage and KNN search

### 5.2 Schema (Multi-Tenant)
```sql
CREATE VIRTUAL TABLE file_embeddings
  USING vec0(
    tenant_id TEXT PARTITION KEY,
    agent_id TEXT PARTITION KEY,
    source_type TEXT,
    namespace TEXT,
    embedding FLOAT[384]
  );
```
Same pattern for `memory_embeddings` and `episodic_embeddings`.

### 5.3 Known Issues
1. **Reindex Bug** (`FileIndexer.ts:22-26`):
   ```typescript
   db.prepare("DELETE FROM file_index WHERE root_id = ?").run(root);
   db.prepare("DELETE FROM file_embeddings WHERE rowid IN (SELECT id FROM file_index WHERE root_id = ?)").run(root);
   ```
   - The subquery returns **empty** because `file_index` rows already deleted!
   - Must capture IDs **before** deleting from `file_index`
   - **Fix**: Capture IDs first, then delete from `file_embeddings`, then delete from `file_index`

2. **Version Pinning**: No lockfile pin for native extension binary compatibility

3. **Migration**: `migrateVec0Tables()` in `connection.ts` handles partition key migration but runs on every startup

### 5.4 Embedding Model
- **Dimension**: 384 (stub FNV-1a hash, not real embeddings)
- **Target**: OCI `text-embedding-3-large` (3072→384 truncated)

---

## 6. Windows Notification Constraints

### 6.1 Current Implementation
- **Bridge**: .NET 8 console app (`apps/notification-bridge-windows/Program.cs`)
- **API**: `Microsoft.Windows.AppNotifications` (Windows App SDK 1.6+)
- **Transport**: HTTP on `localhost:3400` (`NOTIFICATION_BRIDGE_PORT`)
- **Toast Features**: Text, text input (feedback), action buttons (Approve/Reject/Send feedback)
- **Fallback**: In-app approval if bridge unavailable

### 6.2 Critical Bug
**Hardcoded debug log path** (`Program.cs:16`):
```csharp
System.IO.File.AppendAllText(@"C:\Users\Skanda Ganesha L\Temp\opencode\bridge-debug.log", ...)
```
- Must use `%LOCALAPPDATA%\OracleAmigo\logs\notification-bridge.log`
- Or configurable via `ORACLE_AMIGO_NOTIFICATION_LOG_PATH`

### 6.3 Idempotency Gap
- `/approvals/notification-callback` endpoint exists but no idempotency key enforcement
- Duplicate toast clicks could trigger duplicate approvals/transfers

### 6.4 Windows Requirements
- Windows 10 19041+ (Build 19041 = 20H1)
- AppNotificationManager.Register() auto-registers AUMID for unpackaged apps
- No MSIX packaging in current POC

---

## 7. Security Requirements

### 7.1 Email/Password (Control Plane)
- **Hash**: Argon2id via `@node-rs/argon2` (native, fast, secure)
- **Never log**: Passwords, hashes, tokens
- **Rate limit**: Signup/login endpoints (TODO)
- **Email normalization**: Lowercase, trim

### 7.2 Device Tokens
- **Device access tokens**: Short-lived (15 min), signed JWT
- **Refresh tokens**: Long-lived (30 days), stored as **hash** (bcrypt/Argon2id), revocable
- **Device revocation**: Immediate invalidation of all tokens

### 7.3 Agent Private Keys
- **Never leave device**: Generated locally, stored in OS keychain/credential manager
- **Cloud only sees**: Public key, fingerprint, DID
- **Key rotation**: Future work

### 7.4 Relay Authorization
- **Every relay request**: Validates sender/receiver are enrolled, same org, active
- **Inbox access**: Only intended agent_instance can read its inbox
- **Idempotency**: Keys required for all relay operations

### 7.5 File Transfer
- **Approval before upload**: Never upload before explicit user approval
- **Approval binds**: Exact file path, SHA-256, size, recipient agent, task ID, approval ID, timestamp
- **Hash verification**: Receiver MUST verify SHA-256 before storing
- **AES-256-GCM per-transfer encryption**: Each transfer uses a unique key, IV, and AAD
- **No local paths in cloud**: Cloud stores only file name, size, hash, storage path

### 7.6 Tenant/Org Isolation
- **Every cloud table**: Includes `org_id` for multi-tenancy
- **Every local table**: Should include `org_id`, `user_id`, `agent_id`, `device_id`, `namespace` for future migration

---

## 8. Architecture Decision Summary

### 8.1 Control Plane Stack
- **Runtime**: Node.js 24+ (matches local agent)
- **Framework**: Fastify 5.x (matches local agent)
- **Database**: better-sqlite3 (sync, fast, production-ready)
- **Crypto**: @node-rs/argon2 (Argon2id), node:crypto (JWT signing)
- **Validation**: zod 3.x (matches local agent)
- **Logging**: pino (Fastify default) + structured JSON

### 8.2 A2A v1 Binding Decision
- **Primary**: HTTP+JSON binding (matches A2A v1 recommendation)
- **Secondary**: JSON-RPC 2.0 binding (for backward compatibility with v0.3)
- **Card endpoint**: `/.well-known/agent-card.json` returns v1 format
- **Legacy endpoint**: `/.well-known/agent-card.v0.3.json` for backward compat

### 8.3 File Transfer Encryption
- **Algorithm**: AES-256-GCM (per-transfer key + IV + AAD)
- **Key**: 32 random bytes per transfer
- **IV**: 12 random bytes per transfer
- **AAD**: JSON with transfer_id + file_name + sha256
- **Storage**: Encrypted file + sidecar `.meta.json` with crypto params
- **Receiver**: Downloads encrypted, decrypts with shared key from control plane

### 8.4 Two-Laptop Demo (Phase 0)
- **Run two local agents on same machine** with different ports/env
- **Control plane on** port 8080
- **Agent A** on port 3399 (Alice)
- **Agent B** on port 3400 (Bob)
- **Different SQLite paths, storage paths, keys paths**
- **Same CLOUD URL = http://localhost:8080**

### 8.5 OCI GenAI Integration
- **Control plane**: Uses OCI for admin summaries, audit log analysis, intent classification
- **Local agent**: Already uses OCI for embeddings + LLM
- **Shared client**: `src/oci/OciGenAiClient.ts` with connection pooling

---

## 9. Implementation Plan (Confirmed)

### User Decisions
1. **Password hashing**: `@node-rs/argon2` (native, fast, production-grade)
2. **Cloud DB**: Try `better-sqlite3` first (sync, fast), fallback to `node:sqlite` if better-sqlite3 install fails
3. **A2A scope**: **Full v1 implementation** (supportedInterfaces, SCREAMING_SNAKE_CASE, JWS, multi-tenancy, HTTP+JSON)
4. **File transfer encryption**: AES-256-GCM per-transfer (implement now)
5. **Two-laptop demo**: Same machine, different ports/env (then real two-machine later)
6. **Admin UI**: Lightweight React admin tab
7. **OCI**: Use OCI GenAI in both control plane and local agent
8. **Test strategy**: Run full suite after each phase

### Phases
1. Research & Planning (this doc)
2. Control Plane skeleton + DB migrations
3. Auth (signup/login/refresh/logout/me)
4. Device + Agent enrollment
5. Local cloud clients
6. Directory + contacts
7. Presence/heartbeat
8. A2A relay
9. File transfer relay (with AES-256-GCM)
10. A2A v1 full implementation + v0.3 compatibility adapter
11. ANP handshake hardening (canonical payload, replay, expiry, DID resolution)
12. Fix sqlite-vec/FileIndexer reindexAll() bug
13. Windows notification bridge cleanup
14. Admin monitoring APIs
15. React admin tab UI
16. Documentation
17. Comprehensive tests
18. typecheck + test suite
19. Two-laptop demo script
20. Commit + push to main
