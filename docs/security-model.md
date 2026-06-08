# Security Model

## Core Rules

- No file transfer before explicit user approval.
- Approval binds approval ID, task ID, selected file ID, local file path, file name, size, SHA-256, sender/receiver agent instances, and timestamp in the local agent.
- Remote peers never see local file paths.
- The control plane never stores or exposes local paths.
- Notification callbacks are idempotent and DB-backed.
- Approved, rejected, and expired approvals are terminal.
- Duplicate approve/reject callbacks do not trigger duplicate transfers.

## Authentication

- User passwords are hashed with Argon2id.
- Refresh tokens are hashed server-side.
- Device tokens are hashed server-side and revocable.
- Device-authenticated routes verify token hash, expiry, revocation, user status, device status, agent status, and agent-instance status.
- Disabled or revoked devices cannot heartbeat, relay, or transfer.
- Disabled agent instances cannot poll relay.
- Normal user tokens cannot access admin APIs.

## Admin

- Admin auth is separate from user auth.
- Admin sessions use HttpOnly cookies.
- Admin cookies are `Secure` in production via `ADMIN_COOKIE_HOST_PREFIX=true`.
- TOTP secrets are encrypted at rest with `ADMIN_KEK`.
- Recovery codes are hashed.
- Production first-admin setup is disabled unless `ADMIN_SETUP_ENABLED=true`.
- Admin portal does not expose raw file bytes or local file paths.
- Admin controls can disable users, revoke devices, and disable agent instances.

## Relay And Tenancy

- Directory, relay, transfers, presence, tasks, and audit are org-scoped.
- Cross-org relay and directory access are denied by auth context and org-scoped database lookups.
- A2A remote route auth can require bearer/device/relay-style validation with deterministic checks.
- Extended Agent Card requires auth.

## Deterministic Policy Boundary

LLM output must not directly execute sensitive actions. Sensitive actions route through deterministic services and policy checks, especially file transfer approval, shell execution, sandbox/network policy, and admin revocation.

## Known Gaps

- Approval-to-cloud-transfer automation is wired through the local runtimes; the relay E2E now proves approval-triggered upload, receiver download, SHA-256 verification, local storage, and receipt.
- Production relay-token semantics should be tested with real deployment credentials before external exposure.
- Browser E2E accessibility checks should be added once Playwright is stable in the local environment.
