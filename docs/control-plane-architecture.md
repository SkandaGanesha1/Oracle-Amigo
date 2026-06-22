# Control Plane Architecture

The control plane is a multi-tenant Fastify + TypeScript service that brokers cross-device communication for the Oracle Amigo local agents. It now uses Postgres through the async control-plane store and ordered migrations.

## Stack

| Layer | Choice | Why |
| --- | --- | --- |
| HTTP | Fastify 5.3.3 | Schema-validated routing, low overhead, native streaming |
| Storage | Postgres via `pg` pool | Provides managed backups, pooling, HA path, and larger tenant volumes |
| Hashing | `@node-rs/argon2` (Argon2id) | Native binary, no JS shim, side-channel-resistant |
| Tokens | `jsonwebtoken` (HS256) | Standard, easy to rotate |
| Validation | `zod` | One source of truth for env config + request bodies |

## Multi-Tenancy Model

Every cloud table has an `org_id` foreign key. The local agent authenticates as a user; the user belongs to one or more `organizations`. Every read/write query MUST include `org_id` in the WHERE clause. Current service methods enforce this in parameterized statements; new storage code should use `ControlPlaneStore` so tenant boundaries stay centralized.

`apps/control-plane/src/db/ControlPlaneStore.ts` defines the async storage contract: `query`, `one`, `execute`, `transaction`, `migrate`, `healthCheck`, `close`, and `dialect`. `PostgresControlPlaneStore` wraps an explicit `pg` pool. User input is passed as parameters, not concatenated into SQL.

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
- Admin: `requireAdmin` middleware checks a valid session cookie (set by `/v1/admin/auth/login` + MFA). Static `X-Admin-Token` access is development-only; production startup fails if `DEV_ADMIN_TOKEN` or `ADMIN_BOOTSTRAP_TOKEN` is set.

## Data Model

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
            admin_login_challenges
```

All user/agent tables have `org_id` and indexes on `(org_id, …)` lookup columns. The six `admin_*` tables are org-independent (admins operate the control plane, not a tenant).

## Endpoints (summary)

| Path | Method | Auth | Purpose |
| --- | --- | --- | --- |
| `/health` | GET | none | Liveness probe |
| `/v1/auth/signup` | POST | none | Create user |
| `/v1/auth/login` | POST | none | Issue access + refresh |
| `/v1/auth/refresh` | POST | refresh token body | Rotate refresh, issue new access |
| `/v1/auth/logout` | POST | refresh token body | Revoke refresh |
| `/v1/auth/me` | GET | user bearer token | Return current user |
| `/v1/enrollment/complete` | POST | user bearer token | Enroll/update device, agent, and agent instance; issue device token |
| `/v1/devices/me` | GET | user bearer token | List caller devices |
| `/v1/agents/me` | GET | user bearer token | List caller agents and instances |
| `/v1/agents/:agent_instance_id/card` | GET | device bearer token | Return org-scoped Agent Card |
| `/v1/directory/users` | GET | user bearer token | Search same-org users |
| `/v1/directory/users/:user_id/agents` | GET | user bearer token | List same-org user agents |
| `/v1/directory/device/users/:user_id/agents` | GET | device bearer token | Device-authenticated agent lookup for routing |
| `/v1/directory/agent-instances/:agent_instance_id` | GET | user bearer token | Resolve one same-org agent instance |
| `/v1/directory/device/agent-instances/:agent_instance_id` | GET | device bearer token | Device-authenticated agent instance lookup |
| `/v1/contacts/request` | POST | user bearer token | Request contact |
| `/v1/contacts/:contact_id/accept` | POST | user bearer token | Accept contact |
| `/v1/contacts` | GET | user bearer token | List contacts |
| `/v1/presence/heartbeat` | POST | device bearer token | Record heartbeat |
| `/v1/relay/a2a/send` | POST | device bearer token | Enqueue A2A relay message |
| `/v1/relay/a2a/inbox` | GET | device bearer token | Fetch relay inbox |
| `/v1/relay/a2a/:relay_task_id/ack` | POST | device bearer token | Acknowledge delivery |
| `/v1/relay/a2a/:relay_task_id/respond` | POST | device bearer token | Send relay response |
| `/v1/relay/a2a/tasks/:relay_task_id` | GET | device bearer token | Get relay task state |
| `/v1/transfers/init` | POST | device bearer token | Initialize approved transfer |
| `/v1/transfers/:transfer_id/upload` | PUT | device bearer token | Upload bytes |
| `/v1/transfers/:transfer_id/download` | GET | device bearer token | Download bytes |
| `/v1/transfers/:transfer_id/receipt` | POST | device bearer token | Confirm receiver hash check |
| `/v1/admin/auth/...` | GET/POST | varies | Operator auth: setup, login, MFA, me, logout |
| `/v1/admin/...` | GET/POST | session cookie OR admin token | Org-wide views plus explicit revoke/disable actions |

## Peer Routing And Relay Delivery

Local agents should route user chat by stable `peer_user_id` and repair `peer_agent_instance_id` before each relay send. The local `PeerRoutingService` resolves the peer user's current online agent instance with the requested capability (`message.send`, `file.request`, or transfer-related capability) using the directory APIs, then updates the local conversation target when the stored route is stale.

Relay task status is intentionally more precise than the old chat label `sent`. `relay_tasks.status` is the source-of-truth state machine:

`accepted -> queued -> delivered_to_remote_agent -> stored_by_remote_agent -> waiting_approval -> approved -> transfer_started -> completed`

Terminal states are `failed` and `expired`. Not every task visits every approval/transfer state.

| Control-plane state | Local chat delivery state |
| --- | --- |
| `accepted` / `queued` | `queued_at_relay` |
| `delivered_to_remote_agent` | `delivered_to_remote_agent` |
| `stored_by_remote_agent` / `waiting_approval` / `approved` / `transfer_started` / `completed` | `stored_by_remote_agent` |
| `failed` / `expired` | `failed` |

The receiver inbox poller acknowledges relay items only after dispatcher success (`created` or `duplicate`). Failed dispatches are left unacked so the relay item can be retried instead of being silently dropped.

Relay retry controls:

| Env var | Default | Notes |
| --- | --- | --- |
| `RELAY_MAX_DELIVERY_ATTEMPTS` | `5` | Moves to `failed` when exhausted. |
| `RELAY_RETRY_BASE_MS` | `5000` | Exponential backoff base. |
| `RELAY_RETRY_MAX_MS` | `300000` | Backoff cap. |
| `RELAY_TASK_TTL_SECONDS` | `86400` | Moves to `expired` when elapsed. |

See [`relay-architecture.md`](./relay-architecture.md) and [`realtime-transport-plan.md`](./realtime-transport-plan.md) for queue and realtime details.

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

Database runtime:

| Env var | Default | Notes |
| --- | --- | --- |
| `CONTROL_PLANE_DATABASE_URL` | unset | Required preferred Postgres URL |
| `DATABASE_URL` | unset | Postgres fallback |
| `CONTROL_PLANE_PG_POOL_MAX` | `10` | Explicit pool cap |
| `CONTROL_PLANE_PG_IDLE_TIMEOUT_MS` | `30000` | Idle connection timeout |
| `CONTROL_PLANE_PG_CONNECTION_TIMEOUT_MS` | `5000` | Connect timeout |

The cloud control plane is Postgres-only. The local agent database and sqlite-vec file-search storage are separate and unchanged.

For persistent Postgres-backed development, staging, or production, configure stable `JWT_PRIVATE_KEY_PEM` and `JWT_PUBLIC_KEY_PEM`. Without stable PEM values, the non-production control plane generates an in-memory RSA keypair on every restart, invalidating existing access tokens and forcing refresh-token recovery. See `docs/control-plane-persistent-postgres-auth.md` for the key generation and operator setup notes.

## Deployment

The control plane ships as a Node.js service and now has a Podman Compose pilot stack for control-plane + Admin Portal:

```powershell
podman machine start
podman compose -f deploy/docker-compose.pilot.yml up --build
```

Open `http://localhost:8088` for the LAN pilot. The pilot stack uses named Podman volumes for Postgres (`/var/lib/postgresql/data`) and transfer storage (`/app/data/transfers`).

Production browser traffic must terminate TLS at a reverse proxy (Caddy or nginx). Production mode requires HTTPS public URL, `ADMIN_COOKIE_HOST_PREFIX=true`, strong rotated secrets, RS256 JWT keys, and no static admin tokens. The checked-in Compose stack is pilot-only; it is not Kubernetes, HA, or enterprise production readiness.

Health endpoints:

- `/health`: service metadata.
- `/livez`: process liveness.
- `/ready`: database readiness via `ControlPlaneStore.healthCheck()`.

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

`requireAdmin()` accepts a valid session cookie in production. `X-Admin-Token: $DEV_ADMIN_TOKEN` / `X-Admin-Token: $ADMIN_BOOTSTRAP_TOKEN` is development-only; production config validation rejects both variables and the middleware ignores static admin-token paths when effective production mode is active. `requireAdminSession()` is the strict variant (cookie-only) — used by the auth routes themselves.

### Production config gate

Effective production mode is active when either `NODE_ENV=production` or `CONTROL_PLANE_ENV=production`. Startup fails before binding if:

- `CONTROL_PLANE_PUBLIC_URL` is not HTTPS, unless `CONTROL_PLANE_ALLOW_INSECURE_PUBLIC_URL=true` is set for a lab deployment.
- `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `TRANSFER_KEK`, or `ADMIN_KEK` is unset, weak, equal where separation is required, or still uses a development placeholder.
- `JWT_PRIVATE_KEY_PEM` / `JWT_PUBLIC_KEY_PEM` is missing.
- `DEV_ADMIN_TOKEN` or `ADMIN_BOOTSTRAP_TOKEN` is set.
- `ADMIN_COOKIE_HOST_PREFIX` is not `true`.
- `CONTROL_PLANE_CORS_ORIGIN=*`.

First-admin setup in production still requires the explicit operator switch `ADMIN_SETUP_ENABLED=true`; remove it again after setup is complete.

### Topology in prod

```
operator browser
    ↓ HTTPS
reverse proxy (Caddy / nginx) — TLS + IP allowlist
    ↓
127.0.0.1:3398  apps/admin-portal/  (Fastify: @fastify/static + @fastify/http-proxy)
    ↓  /v1/*
127.0.0.1:8080  apps/control-plane/ (auth + business logic + Postgres storage)
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
