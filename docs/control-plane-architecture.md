# Control Plane Architecture

The control plane is a multi-tenant Fastify + TypeScript + SQLite service that brokers cross-device communication for the Oracle Amigo local agents. This document describes the data model, request flow, and the security boundaries that hold it together.

## Stack

| Layer | Choice | Why |
| --- | --- | --- |
| HTTP | Fastify 5.3.3 | Schema-validated routing, low overhead, native streaming |
| Storage | `better-sqlite3` 12 (WAL) | Single-binary deploy, full-text + vector search via sqlite-vec |
| Hashing | `@node-rs/argon2` (Argon2id) | Native binary, no JS shim, side-channel-resistant |
| Tokens | `jsonwebtoken` (HS256) | Standard, easy to rotate |
| Validation | `zod` | One source of truth for env config + request bodies |

## Multi-Tenancy Model

Every cloud table has an `org_id` foreign key. The local agent authenticates as a user; the user belongs to one or more `organizations`. Every read/write query MUST include `org_id` in the WHERE clause; this is enforced by a thin query layer that prepends the org filter to every prepared statement.

Multi-tenant URL prefix is supported on the A2A v1 routes (`/{tenant}/v1/message:send`) but not yet wired into the control plane HTTP API (the control plane derives `org_id` from the JWT).

## Auth Flow

```
client                                control plane
  | POST /auth/signup {email, password, displayName}  |
  |---------------------------------------------------->|
  |                                          hash(pw)   |
  |                                          insert user|
  |<-- 201 {accessToken, refreshToken} ----------------|
  |                                                     |
  | POST /auth/refresh {refreshToken}                   |
  |---------------------------------------------------->|
  |                                          hash(token)|
  |                                          compare     |
  |<-- 200 {accessToken, refreshToken}  ----------------|
  |                                                     |
  | GET /anything  Authorization: Bearer <accessToken> |
  |---------------------------------------------------->|
  |                                          verify JWT  |
  |                                          inject ctx  |
```

- Access tokens: HS256, 15 min TTL, claims = `{ sub: userId, orgId, jti }`.
- Refresh tokens: opaque 32-byte random, SHA-256 hashed in DB, 30 day TTL, revocable.
- Device tokens: separate JWT with claim `type: "device"`, 7 day TTL, tied to `device_id` for agent-instance RPC.
- Admin: `requireAdmin` middleware checks `DEV_ADMIN_TOKEN` env var on the `X-Admin-Token` header.

## Data Model (13 tables)

```
organizations ─< users ─< user_credentials
            ╲            ╲
             ╲            ╲< refresh_tokens
              ╲< devices ─< device_tokens
                ╲         ╲
                 ╲         ╲< agents ─< agent_instances
                  ╲                       (devices registered here)
                   ╲
                    ╲< contacts (org-isolated friendship graph)
                     ╲
                      ╲< presence (per-agent last-seen + status)
                       ╲
                        ╲< relay_tasks ─< relay_messages
                         ╲
                          ╲< file_transfers
                           ╲
                            ╲< transfer_encryption_keys
                             ╲
                              audit_events (SHA-256 hash chain, org-scoped)
```

All tables have `org_id` and indexes on `(org_id, …)` lookup columns.

## Endpoints (summary)

| Path | Method | Auth | Purpose |
| --- | --- | --- | --- |
| `/health` | GET | none | Liveness probe |
| `/auth/signup` | POST | none | Create user |
| `/auth/login` | POST | none | Issue access + refresh |
| `/auth/refresh` | POST | none | Rotate refresh, issue new access |
| `/auth/logout` | POST | refresh | Revoke refresh |
| `/enrollment/devices` | POST | access | Idempotent device enrollment |
| `/enrollment/agents` | POST | access | Register agent on a device |
| `/enrollment/agent-instances` | POST | access | Activate an instance |
| `/directory/users/search` | GET | access | LIKE search on email/displayName |
| `/directory/agents` | GET | access | List agents for a user |
| `/contacts/requests` | POST | access | Request contact |
| `/contacts/requests/{id}/accept` | POST | access | Accept |
| `/contacts` | GET | access | List accepted contacts |
| `/presence` | POST | access | Record heartbeat |
| `/presence/contacts` | GET | access | List online contacts |
| `/relay/send` | POST | access | Enqueue A2A relay message (idempotent) |
| `/relay/inbox` | GET | access | Fetch + mark delivered |
| `/relay/ack/{id}` | POST | access | Acknowledge receipt |
| `/relay/respond/{taskId}` | POST | access | Send reply into task |
| `/relay/tasks/{taskId}` | GET | access | Get task state |
| `/transfers` | POST | access | Initialize encrypted transfer |
| `/transfers/{id}/upload` | PUT | access | Stream ciphertext (raw octet-stream) |
| `/transfers/{id}/download` | GET | access | Stream ciphertext back |
| `/transfers/{id}/receipt` | POST | access | Confirm download + hash check |
| `/admin/...` | GET | admin token | Read-only org-wide views |

## File Transfer Crypto

Per-transfer AES-256-GCM:
- 32-byte key = `HMAC-SHA256(serverSecret, "transfer-key-v1|" + transferId + "|" + fileName + "|" + sha256)`.
- 12-byte random IV.
- AAD = `SHA-256(transferId + "|" + fileName + "|" + sha256 + "|AES-256-GCM")` (length-prefixed in the wire format).
- 16-byte auth tag.

Wire format (little-endian):
```
[4 bytes magic "OAT1"]
[12 bytes IV]
[4 bytes AAD length, big-endian]
[N bytes AAD]
[16 bytes auth tag]
[N bytes ciphertext]
```

Hash verified **twice**:
1. On `POST /transfers/{id}/upload` (after server-side decrypt, before storage).
2. On `POST /transfers/{id}/receipt` (after client decrypt).

## Audit Hash Chain

`audit_events` table is append-only with a SHA-256 chain:
```
event_hash = SHA-256(
  id | orgId | actorUserId | actorAgentInstanceId |
  eventType | detailsJson | previousHash | createdAt
)
```
`verifyAuditChain()` walks the chain in order and recomputes each hash. Any tamper breaks the chain at the modified row.

## Cleanup Loop

A 60-second timer in `main.ts` calls:
- `presenceService.recomputeStalePresence()` — flips offline agents whose last heartbeat is > 5 min old.
- `transfersService.expireOldTransfers()` — deletes transfer rows whose `expires_at` is in the past.

## Error Format

All errors are JSON:
```json
{ "error": "TASK_NOT_FOUND", "message": "No relay task with id=...", "details": {} }
```

## Configuration

All env vars are validated by `zod` at startup; missing or invalid values fail-fast in production (NODE_ENV=production) and use sane defaults in dev. See `apps/control-plane/src/config.ts` for the full list.

## Deployment

The control plane ships as a single Node.js process. For the two-laptop demo:
```
# On the demo machine:
AGENTIC_CONTROL_PLANE_URL=http://127.0.0.1:8080 \
  node apps/control-plane/dist/main.js
```

In production: put behind a reverse proxy (nginx, Caddy) with TLS termination. Bind to `127.0.0.1` and let the proxy handle public traffic.
