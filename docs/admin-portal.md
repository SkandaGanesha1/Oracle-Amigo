# Admin Portal

The Admin Portal is the operator-facing web application for the Oracle Amigo control plane. It replaces the in-chat **Admin Console** tab (Phase 15) with a standalone React app served by its own Fastify adapter on a separate port, with production-grade operator auth (Argon2id password + TOTP 2FA + recovery codes + HttpOnly session cookie).

> **Scope:** read-only monitoring (KPIs, users, devices, presence, tasks, transfers, audit) + operator auth (bootstrap, login, MFA, recovery, session). There are no destructive actions in the UI; the control plane deliberately exposes no `POST /v1/admin/*` mutation endpoints. All destructive operations happen out-of-band (SQLite, curl) and are visible in the Cloud Audit Log.

## Why a separate portal

The Phase 15 admin tab was useful but had three real problems:

1. **The token sat in `sessionStorage`.** Any XSS in the chat app could read it. Tabs share origin.
2. **Auth was a single shared secret (`DEV_ADMIN_TOKEN`).** No per-operator identity, no rotation, no MFA, no audit of *who* loaded the page.
3. **The admin bundle added ~170 KB to every chat load.** A standalone portal keeps the chat light and lets the admin bundle grow independently.

Phase 15b fixes all three.

## Topology

```
operator browser
    |
    | HTTPS  (reverse proxy in prod; direct in dev)
    v
+-------------------------------------------+
|  127.0.0.1:3398   apps/admin-portal/      |   <-- static + reverse proxy
|  (Fastify adapter)                        |       (no business logic)
+-------------------------------------------+
    |  GET /v1/admin/auth/*  (cookie forwarded)
    |  GET /v1/admin/*       (cookie forwarded)
    v
+-------------------------------------------+
|  127.0.0.1:8080   apps/control-plane/     |   <-- auth + read-only data
+-------------------------------------------+
```

The portal is a **thin Fastify adapter**: it serves the built React SPA from `apps/admin-portal/public/` and reverse-proxies `/v1/*` to the control plane. The control plane is the only place that knows about admin users, passwords, TOTP secrets, or sessions.

The two services share the same hostname so the browser treats them as one origin — cookies set by `/v1/admin/auth/login` on `:8080` are sent on every `/v1/admin/*` call. In dev, Vite's dev server (`127.0.0.1:5174`) proxies `/v1/*` to the control plane on `127.0.0.1:8080`, and the portal's Vite config is separate (`ui-admin/`).

## Quick start (dev)

```bash
# Terminal 1: control plane (port 8080)
npm --prefix apps/control-plane run dev

# Terminal 2: portal Vite dev server (port 5174) with proxy to control plane
npm --prefix ui-admin run dev

# Open http://127.0.0.1:5174
```

The first time you load the portal, you'll see **Bootstrap first admin** (no `setup` route exists until an admin is created). After bootstrap, the login screen takes its place.

## Quick start (prod)

```bash
# Build the React bundle
npm run --prefix ui-admin build

# Start the control plane (cookie prefix MUST be __Host- in prod)
NODE_ENV=production \
  CONTROL_PLANE_PORT=8080 \
  ADMIN_KEK="<at-least-32-chars-of-entropy>" \
  ADMIN_COOKIE_HOST_PREFIX=true \
  ADMIN_BOOTSTRAP_TOKEN="" \
  node apps/control-plane/dist/main.js

# Start the portal on 3398
NODE_ENV=production \
  ADMIN_PORTAL_PORT=3398 \
  CONTROL_PLANE_URL=http://127.0.0.1:8080 \
  ADMIN_STATIC_ROOT=$(pwd)/apps/admin-portal/public \
  node apps/admin-portal/dist/server.js
```

Put a reverse proxy (Caddy, nginx) in front of `:3398` with TLS. The proxy must forward `Cookie` (request) and `Set-Cookie` (response) headers verbatim. `@fastify/http-proxy` v11.5+ does this by default.

## Operator journey

### 1. First-admin bootstrap

A fresh database has no admin users. `GET /v1/admin/auth/setup-status` returns `{ required: true, has_any_admin: false }` and the portal shows a 3-step wizard:

| Step | Inputs | Server action |
| --- | --- | --- |
| Credentials | email, display name, password | `POST /v1/admin/auth/setup/start` returns a 10-minute `challenge`, the provisioning URI (`otpauth://totp/...`), and the Base32 secret. |
| Scan QR | TOTP code from authenticator | Server looks up the encrypted secret by `challenge` token hash, verifies the TOTP code with `TOTP.verifyRaw`, then persists: Argon2id password hash, TOTP secret (AES-256-GCM at rest), and **10 one-time recovery codes** (Crockford base32, formatted `XXXXX-XXXXX`). |
| Recovery codes | (display-only) | The 10 codes are shown once and never again. Operator must save them now. |

A successful bootstrap sets the session cookie and returns the admin user object. The server enforces "one admin only" by counting rows in a `BEGIN IMMEDIATE` transaction — a second setup attempt returns `409 SETUP_DISABLED`.

### 2. Login + MFA

Returning operators hit the login screen:

1. **Password step.** `POST /v1/admin/auth/login` with `{ email, password }`. If the password is correct, the server returns `{ status: "mfa_required", challenge, expires_in: 300 }`. Wrong passwords increment the per-email lockout counter (5 fails / 15 min → 429). No password is ever logged.
2. **TOTP step.** The 6-digit code from the authenticator is posted to `POST /v1/admin/auth/mfa/verify`. The server decrypts the stored secret, verifies with a 30s window, and atomically updates `last_used_counter` to defeat replays. On success, the session cookie is set and the user object returned.
3. **Recovery step (alt).** Lost phone? `POST /v1/admin/auth/mfa/recovery` with one of the 10 saved codes. On success, the **remaining 9 codes are invalidated** and 10 new ones are returned (the operator must save them again). The next login uses the new set.

The session is an HttpOnly, SameSite=Strict cookie. Prod uses `__Host-admin_session` (no `Domain` attribute; `Path=/`; `Secure`); dev uses `admin_session` (no `Secure` so it works over plain HTTP). The cookie holds an opaque 32-byte token; only the SHA-256 hash is stored server-side.

### 3. In-session behavior

* **Idle timeout 1 hour, absolute timeout 8 hours.** Both timers tick client-side (the cookie doesn't carry them). The header shows the live countdown. Backgrounding the tab does not stop the timer.
* **API errors are loud.** Any 401 or 403 from a `/v1/admin/*` call clears local session state and routes back to the login screen. This is the "I logged in fine yesterday, why am I locked out now?" safety net.
* **No localStorage for credentials.** The session lives in the cookie; the user object is held in React state only.

### 4. Logout

`POST /v1/admin/auth/logout` invalidates the session row server-side and clears the cookie via `Set-Cookie` with `Max-Age=0`. Closing the tab without logging out still expires after 1h idle.

## Pages

| Route | Component | Polling | What it shows |
| --- | --- | --- | --- |
| `#/` | `OverviewPage` | 5s | KPI cards (users, devices, instances, online, open tasks, active transfers, audit events), recent activity, live presence. |
| `#/users` | `UsersPage` | 15s | Searchable user list. |
| `#/devices` | `DevicesPage` | 15s | Devices with fingerprint + last-seen. |
| `#/instances` | `AgentInstancesPage` | 10s | Agent instances with status pill. |
| `#/presence` | `PresencePage` | 5s | Online / stale / offline counters. |
| `#/tasks` | `TasksPage` | 10s | A2A relay tasks (latest 500). |
| `#/transfers` | `TransfersPage` | 10s | Virtualized; "expiring soon" badge. |
| `#/audit` | `AuditPage` | 15s | **Virtualized**; client-side SHA-256 hash-chain verifier. |

The hash chain verifier on the Audit page recomputes each `event_hash` from the canonical payload:

```
id | org_id | actor_user_id | actor_agent_instance_id |
event_type | details_json | previous_hash | created_at
```

It walks the events in ascending `id` order, recomputes the hash, compares it to the server's stored `event_hash`, and verifies the chain link by comparing `previous_hash` to the prior event's `event_hash`. On a mismatch the UI shows the broken event ID and a red ✗. This is informational and complements (does not replace) the server-side `verifyAuditChain()` in `CloudAuditService`.

## Tech stack

| Concern | Choice | Why |
| --- | --- | --- |
| Auth crypto | Argon2id (memoryCost=19456, timeCost=2, parallelism=1) | OWASP 2025 minimum. |
| 2FA | TOTP RFC 6238 (SHA1, 6 digits, 30s period, 20-byte secret) via `otpauth ^9.5.1` | Industry standard, 30k+ dependents, no proprietary tokens. |
| Session | 32-byte random token in HttpOnly cookie, sha256 stored | No JWT; revocation is a single `DELETE`. |
| Transport | Cookie prefix `__Host-` in prod, `admin_session` in dev | Forbids subdomain leakage + requires HTTPS. |
| Vite | Separate `ui-admin/` Vite project | Keeps the chat bundle small; lets the portal evolve independently. |
| Tailwind | v4 | Same as the chat app; no new CSS pipeline. |
| Data fetching | `@tanstack/react-query ^5.59` | Cache, dedupe, refetch intervals, error retry. |
| Tables | `@tanstack/react-table ^8.20` + `@tanstack/react-virtual ^3.10` | 100k-row capable. |
| QR | `qrcode ^1.5.4` | Renders the TOTP provisioning URI. |
| Icons | `lucide-react` | Same as the chat app. |
| Hash routing | native `hashchange` listener | Single static bundle. |
| Proxy | `@fastify/http-proxy ^11.5.0` (post-CVE-2026-33805) | Forwards `Cookie` + `Set-Cookie` by default. |
| Static | `@fastify/static ^8.2.0` | SPA fallback via `setNotFoundHandler`. |

## Files

| File | Purpose |
| --- | --- |
| `apps/control-plane/src/db/schema.sql` | Tables: `admin_users`, `admin_totp_secrets`, `admin_recovery_codes`, `admin_sessions`, `admin_login_attempts`, `admin_setup_challenges`. |
| `apps/control-plane/src/config.ts` | 7 new env vars: `ADMIN_SESSION_IDLE_TTL_SECONDS`, `ADMIN_SESSION_ABSOLUTE_TTL_SECONDS`, `ADMIN_LOGIN_RATELIMIT_PER_EMAIL`, `ADMIN_LOGIN_RATELIMIT_PER_IP`, `ADMIN_LOGIN_LOCKOUT_MINUTES`, `ADMIN_KEK`, `ADMIN_COOKIE_HOST_PREFIX`. |
| `apps/control-plane/src/admin/AdminCrypto.ts` | AES-256-GCM (12B IV + 16B tag) for TOTP secret at rest. |
| `apps/control-plane/src/admin/TOTPService.ts` | RFC 6238 verify + provisioning URI builder; `verifyRaw` exported. |
| `apps/control-plane/src/admin/AdminSessionService.ts` | Token mint/verify, cookie name, idle/absolute expiry. |
| `apps/control-plane/src/admin/AdminRateLimit.ts` | Sliding-window counters per email and per IP. |
| `apps/control-plane/src/admin/AdminAuthService.ts` | `startSetup`, `setupFirstAdmin`, `loginStep1`, `verifyMfaTotp`, `verifyMfaRecovery`, `meFromSession`, `logout`, `getSetupStatus`. |
| `apps/control-plane/src/admin/AdminAuthRoutes.ts` | 7 Fastify routes + Zod schemas. |
| `apps/admin-portal/src/server.ts` | Fastify adapter: `@fastify/static` (SPA fallback) + `@fastify/http-proxy` (`/v1/*`). |
| `apps/admin-portal/src/config.ts` | `ADMIN_PORTAL_PORT` (default 3398), `CONTROL_PLANE_URL`, `ADMIN_STATIC_ROOT`. |
| `ui-admin/src/portal/PortalApp.tsx` | State machine: `loading` → `setup` (if `setup-status.required`) → `login` → `dashboard`. |
| `ui-admin/src/portal/auth/` | `useSession`, `useSetupStatus`, `LoginFlow`, `SetupFlow`, `SessionBanner`, `QrCode`, `api.ts`, `types.ts`. |
| `ui-admin/src/portal/{api,components,layout,pages}/` | Moved from `ui/src/admin/` and reworked to be cookie-based. |
| `ui-admin/vite.config.ts` | Separate Vite project; dev proxy `/v1 → 127.0.0.1:8080`; build output → `apps/admin-portal/public/`. |
| `tests/admin-ui-snapshots.test.ts` | Source-snapshot integrity (renamed from "admin-ui" — covers both projects). |
| `tests/admin-ui-build.test.ts` | Build-time bundle assertions (chat is admin-free; portal has auth surfaces). |
| `apps/control-plane/tests/admin-auth.test.ts` | 12 unit tests: setup, login, MFA, recovery, lockout, replay defense, /me, logout. |
| `apps/admin-portal/tests/admin-portal.test.ts` | 7 integration tests: health, proxy of `/v1/admin/auth/*`, cookie forwarding, SPA fallback, 404. |

## Configuration reference

### Control plane

| Env var | Default | Notes |
| --- | --- | --- |
| `ADMIN_SESSION_IDLE_TTL_SECONDS` | `3600` | 1h idle. |
| `ADMIN_SESSION_ABSOLUTE_TTL_SECONDS` | `28800` | 8h absolute. |
| `ADMIN_LOGIN_RATELIMIT_PER_EMAIL` | `5` | Failed attempts before 429. |
| `ADMIN_LOGIN_RATELIMIT_PER_IP` | `20` | Failed attempts per source IP. |
| `ADMIN_LOGIN_LOCKOUT_MINUTES` | `15` | Lockout window. |
| `ADMIN_KEK` | *(required in prod)* | At least 32 chars. The KEK is SHA-256-hashed to a 32-byte AES key for encrypting TOTP secrets at rest. Prod rejects the `change-me...` placeholder. |
| `ADMIN_COOKIE_HOST_PREFIX` | `true` in prod, `false` in dev | Toggles `__Host-` prefix. Prod fails-fast if not `true`. |
| `ADMIN_BOOTSTRAP_TOKEN` | *(unset)* | Bootstrap escape hatch for `requireAdmin`; not for sessions. Prod fails-fast if set. |
| `DEV_ADMIN_TOKEN` | *(dev only)* | Same as above, dev-only name. |

### Portal

| Env var | Default | Notes |
| --- | --- | --- |
| `ADMIN_PORTAL_PORT` | `3398` | HTTP port. |
| `CONTROL_PLANE_URL` | `http://127.0.0.1:8080` | Where `/v1/*` is proxied. |
| `ADMIN_STATIC_ROOT` | `public` | Static root used by the Fastify portal adapter; set to `<repo>/apps/admin-portal/public` when launching from outside `apps/admin-portal/`. |

## API contract

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| `GET` | `/v1/admin/auth/setup-status` | — | `{ required: boolean, has_any_admin: boolean }` |
| `POST` | `/v1/admin/auth/setup/start` | — | `{ challenge, provisioning_uri, secret_base32, expires_in: 600 }` |
| `POST` | `/v1/admin/auth/setup` | `{ email, display_name, password, totp_code, setup_challenge }` | `201 { user, recovery_codes: string[10] }` + `Set-Cookie` |
| `POST` | `/v1/admin/auth/login` | `{ email, password }` | `200 { status: "ok", user }` + `Set-Cookie`, **or** `200 { status: "mfa_required", challenge, expires_in: 300 }` |
| `POST` | `/v1/admin/auth/mfa/verify` | `{ challenge, totp_code }` | `200 { user }` + `Set-Cookie` |
| `POST` | `/v1/admin/auth/mfa/recovery` | `{ challenge, recovery_code }` | `200 { user, recovery_codes: string[10] }` (rotated) + `Set-Cookie` |
| `GET` | `/v1/admin/auth/me` | — | `200 { user: { id, email, display_name, totp_enrolled, is_disabled, created_at } }` with valid session, or `401` |
| `POST` | `/v1/admin/auth/logout` | — | `204` + `Set-Cookie: ...; Max-Age=0` |

The read-only data endpoints under `/v1/admin/*` (users, devices, agent-instances, presence, tasks, transfers, audit) are unchanged from Phase 15 — see [`admin-monitoring.md`](./admin-monitoring.md). They now require a valid session cookie in addition to (or instead of) `X-Admin-Token`; the `requireAdmin` middleware accepts either.

## Security model

* **Passwords**: Argon2id with OWASP 2025 params; 32-byte salt; constant-time verify.
* **TOTP secrets at rest**: AES-256-GCM keyed by `SHA-256("oracle-amigo.admin.kek.v1:" + ADMIN_KEK)`. 12B random IV per encrypt; 16B auth tag. Stored as base64url(`iv.ct.tag`).
* **Recovery codes**: 10 × 10 chars of Crockford base32 (no `I`/`L`/`O`/`U`/`0`/`1`); displayed once at bootstrap; stored as `SHA-256(normalized_code)`. Using one code invalidates the other nine and issues ten new ones.
* **Session tokens**: 32 bytes from `crypto.randomBytes`; base64url. Only `SHA-256(token)` is stored. Logout deletes the row, so a stolen cookie is invalidated on next logout.
* **MFA challenges**: short-lived opaque tokens in `admin_login_challenges` (300s TTL). Single-use via atomic `UPDATE ... SET used_at = ? WHERE used_at IS NULL`.
* **TOTP replay defense**: `admin_totp_secrets.last_used_counter` is updated atomically on each verify; the next login with the same code (within the 30s window) returns `CHALLENGE_REPLAY`.
* **Rate limiting**: per-email (5 fails / 15 min) **and** per-IP (20 fails / 15 min). Lockout is sliding-window; the same operator logging in from a different IP doesn't escape the per-email counter.
* **Setup race**: setup uses `BEGIN IMMEDIATE` + a `COUNT(*)` precheck. A second setup attempt (e.g. someone races the bootstrap wizard) returns `409 SETUP_DISABLED`.
* **Bootstrap token escape hatch**: `requireAdmin` accepts `ADMIN_BOOTSTRAP_TOKEN` / `DEV_ADMIN_TOKEN` as a header in addition to the session cookie. This is the recovery path if the portal can't be unlocked. **Set it to empty in production.**
* **No secret logging**: passwords, TOTP codes, recovery codes, session tokens, and KEK material are never written to logs, console, or telemetry.
* **Bundle isolation**: the chat bundle is verified to be free of `/v1/admin/auth/*`, `__Host-admin_session`, `X-Admin-Token`, `TOTP`, and `recovery_codes` strings by `tests/admin-ui-build.test.ts`. The portal bundle is verified to contain them. The two bundles never ship together.

## Threat model (assumptions)

This model assumes:

* The control plane runs on a hardened host. The KEK never leaves the process; the database is the only place TOTP secrets are persisted (encrypted).
* The reverse proxy terminates TLS. The portal never serves a non-HTTPS request in prod.
* The operator's browser is reasonably modern. We use `crypto.subtle` for the audit hash chain.
* The chat app and the portal share the same origin (single hostname, two ports). Cross-origin access between the two would require deliberate configuration.

Out of scope:

* Brute-forcing an Argon2id password (memoryCost=19456 is the cost we pay; 5-attempt lockout per 15 min is the cap).
* Compromised operator endpoint (the cookie can be exfiltrated by a malicious browser extension — use a clean device).
* Compromise of `ADMIN_KEK` (rotate by setting a new KEK, then re-encrypting all TOTP secrets — there is no automatic rotation script in this release).
* Side-channel attacks against the Argon2 native binary.

## Extending

1. **Add a new admin data endpoint** to `apps/control-plane/src/admin/AdminRoutes.ts`. Use `requireAdmin` (cookie OR bootstrap token).
2. **Add a TS type** to `ui-admin/src/portal/api/types.ts`.
3. **Add a TanStack hook** to `ui-admin/src/portal/api/queries.ts`.
4. **Add a new page** under `ui-admin/src/portal/pages/`.
5. **Register the page** in `AdminRouter.tsx` and the sidebar `items` in `Sidebar.tsx`.

The build-time test `tests/admin-ui-snapshots.test.ts` will catch missing types or routes.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| Portal loads but login fails with CORS / 401 | The portal's Vite proxy isn't running, or the control plane is on a different port than `CONTROL_PLANE_URL`. |
| `http://127.0.0.1:3398/` is health-only or blank in dev | Build the SPA first with `npm --prefix ui-admin run build`; the Vite dev UI runs at `http://127.0.0.1:5174/`. |
| `http://127.0.0.1:5174/` is a black page | Check the browser console for a React runtime error. Bootstrap and login screens require the root `QueryClientProvider` in `ui-admin/src/main.tsx`. |
| "Admin session has expired" on a busy tab | The 1h idle timer ticked past — this is by design. Re-authenticate. |
| "Bootstrap first admin" loop | The first admin was created but the wizard got stuck. Log in directly — the setup endpoint is hidden when an admin exists. |
| TOTP code rejected, clock OK | The server clock differs from the authenticator's by more than 30s. Sync NTP. |
| 3 wrong passwords → 429 | Per-email lockout. Wait 15 min or use a recovery code. |
| Cookie set but `/v1/admin/auth/me` returns 401 | The cookie was set in dev (`admin_session`) but you hit a prod portal (`__Host-admin_session` only matches on `Path=/; Secure; HTTPS; no Domain`). |
| Hash chain "broken at #N" on the Audit page | Real chain break, or the server-side canonicalization changed and the client is on a different schema. Cross-check with `verifyAuditChain()` on the server. |
| Recovery code rejected after one use | All 10 codes are rotated on each successful use. Use a new code from the set you saved. |
| Vite build fails with "Cannot resolve `apps/admin-portal/public`" | `vite.config.ts` `outDir` must be `path.resolve(__dirname, "../apps/admin-portal/public")` (one level up from `ui-admin/`). |
