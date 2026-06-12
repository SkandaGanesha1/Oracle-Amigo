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
- Admin: `requireAdmin` middleware checks **either** a valid session cookie (set by `/v1/admin/auth/login` + MFA) **or** the `X-Admin-Token` header (`DEV_ADMIN_TOKEN` in dev, `ADMIN_BOOTSTRAP_TOKEN` in prod). See [Admin Portal](#admin-portal-phase-15b) below for the operator auth flow.

## Data Model (19 tables)

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

admin_users ─< admin_totp_secrets
           ╲< admin_recovery_codes
           ╲< admin_sessions
            admin_login_attempts
            admin_setup_challenges
```

All user/agent tables have `org_id` and indexes on `(org_id, …)` lookup columns. The six `admin_*` tables are org-independent (admins operate the control plane, not a tenant).

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
| `/admin/...` | GET | session cookie OR admin token | Read-only org-wide views |
| `/v1/admin/auth/...` | GET/POST | varies | Operator auth: setup, login, MFA, me, logout |

## Peer Routing And Relay Delivery

Local agents should route user chat by stable `peer_user_id` and repair `peer_agent_instance_id` before each relay send. The local `PeerRoutingService` resolves the peer user's current online agent instance with the requested capability (`message.send`, `file.request`, or transfer-related capability) using the directory APIs, then updates the local conversation target when the stored route is stale.

Relay task status is intentionally more precise than the old chat label `sent`:

| Control-plane state | Local chat delivery state |
| --- | --- |
| accepted / pending | `queued_at_relay` |
| inbox fetched / delivered | `delivered_to_remote_agent` |
| receiver dispatcher wrote the local chat row and responded | `stored_by_remote_agent` |
| receiver dispatcher failure, cancellation, or expiry | `failed` |

The receiver inbox poller acknowledges relay items only after dispatcher success (`created` or `duplicate`). Failed dispatches are left unacked so the relay item can be retried instead of being silently dropped.

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

## Admin Portal (Phase 15b)

The operator-facing admin UI is a **standalone React app** served by a thin Fastify adapter (`apps/admin-portal/`, default port `3398`) that reverse-proxies `/v1/*` to the control plane on `127.0.0.1:8080`. The two services share the same hostname so the browser treats them as one origin (cookies set on `:8080` are sent on `:3398`).

### Why split

Phase 15 shipped an in-chat admin tab gated by a single shared `DEV_ADMIN_TOKEN` stored in `sessionStorage`. That had three problems: any XSS in chat could read the token, there was no per-operator identity or MFA, and the admin bundle added ~170 KB to every chat load. Phase 15b fixes all three.

### Auth crypto

| Concern | Implementation |
| --- | --- |
| Password | Argon2id (`@node-rs/argon2`, memoryCost=19456, timeCost=2, parallelism=1). |
| 2FA | TOTP RFC 6238 via `otpauth ^9.5.1`; SHA1, 6 digits, 30s period, 20-byte secret. |
| TOTP secret at rest | AES-256-GCM keyed by `SHA-256("oracle-amigo.admin.kek.v1:" + ADMIN_KEK)`; 12B random IV, 16B auth tag, base64url(`iv.ct.tag`). |
| Recovery codes | 10 × 10 chars Crockford base32 (no `I`/`L`/`O`/`U`/`0`/`1`); displayed once at bootstrap; stored as `SHA-256(normalized)`; using one invalidates the other nine. |
| Session token | 32B `crypto.randomBytes` → base64url; only `SHA-256(token)` stored. |
| Session cookie | `__Host-admin_session` in prod (HttpOnly, Secure, SameSite=Strict, Path=/, no Domain); `admin_session` in dev (no Secure). |
| Session lifetime | 1h idle / 8h absolute. |

### Auth flow

```
first-run:                   returning operator:
  GET /v1/admin/auth/setup-status     GET /v1/admin/auth/me (cookie?)
    → { required: true }                ↳ 200 { user } (skip to dashboard)
  POST /v1/admin/auth/setup/start    POST /v1/admin/auth/login {email, password}
    → { challenge, provisioning_uri,    ↳ mfa_required { challenge }
      secret_base32, expires_in: 600 }   ↳ 429 if locked out
  POST /v1/admin/auth/setup              POST /v1/admin/auth/mfa/verify
    { email, display_name, password,      { challenge, totp_code }
      totp_code, setup_challenge }        ↳ 200 { user } + Set-Cookie
    → 201 { user, recovery_codes[10] }
```

The setup endpoint verifies the TOTP code **server-side** (looking up the encrypted secret by `setup_challenge` token hash) before persisting the admin row. The setup wizard's QR code is the only time the TOTP secret is shown; the client cannot keep it.

### Operator middleware

`requireAdmin()` accepts **either** a valid session cookie **or** `X-Admin-Token: $DEV_ADMIN_TOKEN` (dev) / `X-Admin-Token: $ADMIN_BOOTSTRAP_TOKEN` (prod). The bootstrap token is a deliberate escape hatch for incident response; in prod it must be empty after the first admin is bootstrapped. `requireAdminSession()` is the strict variant (cookie-only) — used by the auth routes themselves.

### Topology in prod

```
operator browser
    ↓ HTTPS
reverse proxy (Caddy / nginx) — TLS + IP allowlist
    ↓
127.0.0.1:3398  apps/admin-portal/  (Fastify: @fastify/static + @fastify/http-proxy)
    ↓  /v1/*
127.0.0.1:8080  apps/control-plane/ (auth + business logic + SQLite)
```

The reverse proxy must forward `Cookie` (request) and `Set-Cookie` (response) headers verbatim. `@fastify/http-proxy` v11.5+ does this by default.

### Tables added

| Table | Purpose |
| --- | --- |
| `admin_users` | Email, display name, Argon2id password hash, TOTP enrolled flag, disabled flag, last login. |
| `admin_totp_secrets` | AES-256-GCM-encrypted TOTP secret, `last_used_counter` (replay defense), `provisioning_uri`, `secret_base32` (shown once). |
| `admin_recovery_codes` | SHA-256 hashes of the 10 recovery codes, with a `used_at` timestamp. |
| `admin_sessions` | `token_hash`, `created_at`, `last_seen_at`, `expires_at`, `absolute_expires_at`, `user_agent`, `ip`. |
| `admin_login_attempts` | Sliding-window counters per email and per IP. |
| `admin_setup_challenges` | One-shot setup challenges: `token_hash`, `totp_secret_encrypted`, `provisioning_uri`, `secret_base32`, `expires_at`, `used_at`. 10-min TTL. |

For the full operator guide, security model, and troubleshooting, see [`admin-portal.md`](./admin-portal.md).
