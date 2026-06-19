# Security Model

## Core Rules

- No file transfer before explicit user approval.
- Approval binds approval ID, task ID, selected file ID, local file path, file name, size, SHA-256, sender/receiver agent instances, and timestamp in the local agent.
- Remote peers never see local file paths.
- The control plane never stores or exposes local paths.
- Notification callbacks are idempotent and DB-backed.
- Approved, rejected, and expired approvals are terminal.
- Duplicate approve/reject callbacks do not trigger duplicate transfers.
- Quick Voice command creation, history, command SSE, confirmation, and cancellation are local-agent protected. A voice command can prepare a preview, but relay/file-transfer work still requires deterministic validation and confirmation before execution.
- Receiver approval routes and intent helper routes are local-agent protected because they can carry selected local file paths or sensitive user text.

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
- Production rejects `DEV_ADMIN_TOKEN` and `ADMIN_BOOTSTRAP_TOKEN`; static admin header tokens are development-only.
- Production control-plane startup fails fast unless `CONTROL_PLANE_PUBLIC_URL` is HTTPS, JWT/admin/transfer secrets are explicitly strong, RS256 key material is present, and CORS is not wildcard.
- Admin portal does not expose raw file bytes or local file paths.
- Admin controls can disable users, revoke devices, and disable agent instances.
- Admin views and actions must not expose raw local paths, file bytes, bearer tokens, device tokens, refresh tokens, TOTP secrets, recovery-code hashes, or raw relay payloads.

## Relay And Tenancy

- Directory, relay, transfers, presence, tasks, and audit are org-scoped.
- Cross-org relay and directory access are denied by auth context and org-scoped database lookups.
- A2A remote route auth can require bearer/device/relay-style validation with deterministic checks.
- Extended Agent Card requires auth.
- Local-agent production startup rejects `AGENTIC_A2A_REMOTE_AUTH_REQUIRED=false` and rejects non-loopback `SANDBOX_HOST` unless `LOCAL_AGENT_ALLOW_UNSAFE_PUBLIC_BIND=true` is explicitly set.
- Local cloud tokens and new local identity private keys are centralized behind the local `SecretStore` abstraction.
- `SECRET_STORE=file` is development-only by default. Production rejects it unless `ALLOW_UNSAFE_FILE_SECRET_STORE=true` is explicitly set for a controlled lab.
- Production Windows/macOS packaging must implement native Windows Credential Manager/DPAPI or macOS Keychain storage before broad release.

## Deterministic Policy Boundary

LLM output must not directly execute sensitive actions. Sensitive actions route through deterministic services and policy checks, especially file transfer approval, shell execution, sandbox/network policy, and admin revocation.

## Known Gaps

- Approval-to-cloud-transfer automation is wired through the local runtimes; the relay E2E now proves approval-triggered upload, receiver download, SHA-256 verification, local storage, and receipt.
- Production relay-token semantics should be tested with real deployment credentials before external exposure.
- Browser E2E accessibility checks should be added once Playwright is stable in the local environment.
- Production packaging must set strong `LOCAL_AGENT_API_TOKEN`, `LOCAL_AGENT_UI_SESSION_SECRET`, `APPROVAL_CALLBACK_SECRET`, JWT secrets, transfer KEK, and admin KEK values instead of relying on dev/test defaults.
- OS credential storage for local device keys/tokens remains a production hardening item; the file secret store is now blocked in production unless explicitly overridden.
