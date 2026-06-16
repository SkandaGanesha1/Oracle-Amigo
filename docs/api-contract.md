# Control Plane API Contract

Date: 2026-06-07

All control-plane product APIs use the `/v1` prefix. Local-agent `/cloud/*` and `/relay/*` routes are local facade routes only; they translate UI requests into this control-plane contract.

## Local Agent Agentic Facade

These routes are local-agent routes, not control-plane routes. They are same-origin/local protected and are the canonical UI contract for the agentic control surface.

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/missions` | Return canonical mission projections joined from workflow tasks, approvals, transfers, agent runs, voice commands, and linked chat conversations. |
| `GET` | `/missions/:missionId` | Return one canonical mission projection. |
| `GET` | `/missions/:missionId/thread` | List side-thread messages for a mission. |
| `POST` | `/missions/:missionId/thread` | Add a mission side-thread message. |
| `GET` | `/missions/:missionId/thread/events` | Stream mission-thread messages over SSE. |
| `POST` | `/missions/:taskId/pause` | Pause an A2A-backed mission task. |
| `POST` | `/missions/:taskId/resume` | Resume an A2A-backed mission task. |
| `POST` | `/missions/:taskId/cancel` | Cancel an A2A-backed mission task. |
| `POST` | `/missions/:taskId/retry` | Retry an A2A-backed mission task. |
| `GET` | `/events` | Stream normalized realtime SSE snapshots for missions and voice commands, with polling fallback on the frontend. |
| `GET` | `/settings/user-agent` | Load persisted user-agent privacy, notification, autonomy, and file-access settings. |
| `PUT` | `/settings/user-agent` | Replace persisted user-agent settings after Zod validation and append an audit event. |

Mission projections include `id`, `source`, `status`, `participants`, `risk`, `dataMovement`, `steps`, `artifacts`, `approvals`, `transfers`, `agentRunIds`, `a2aTaskIds`, `voiceCommandId`, linked `conversationId`, timestamps, and failure/retry metadata. Sensitive command traces and local paths remain redacted before they are returned to the UI.

## Auth

| Method | Route | Auth | Purpose |
|---|---|---|---|
| `POST` | `/v1/auth/signup` | none | Create user and issue user access + refresh tokens. |
| `POST` | `/v1/auth/login` | none | Authenticate user and issue user access + refresh tokens. |
| `POST` | `/v1/auth/refresh` | refresh token body | Issue a new user access token from a hashed server-side refresh token. |
| `POST` | `/v1/auth/logout` | refresh token body | Revoke a refresh token. |
| `GET` | `/v1/auth/me` | user bearer token | Return current user identity. |

## Enrollment

| Method | Route | Auth | Purpose |
|---|---|---|---|
| `POST` | `/v1/enrollment/complete` | user bearer token | Enroll or update device, agent, and agent instance; issue DB-backed device token. |
| `GET` | `/v1/devices/me` | user bearer token | List current user's devices. |
| `GET` | `/v1/agents/me` | user bearer token | List current user's agents and instances. |
| `GET` | `/v1/agents/:agent_instance_id/card` | device bearer token | Return a cloud-reachable, org-scoped Agent Card for an active agent instance. |

## Directory And Contacts

| Method | Route | Auth | Purpose |
|---|---|---|---|
| `GET` | `/v1/directory/users?q=` | user bearer token | Search users within the authenticated organization only; agent rows include relay inbox URL, Agent Card URL, and card hash. |
| `GET` | `/v1/directory/users/:user_id/agents` | user bearer token | List active agents for a user in the authenticated organization with relay/card metadata. |
| `POST` | `/v1/contacts/request` | user bearer token | Request a contact relationship. |
| `POST` | `/v1/contacts/:contact_id/accept` | user bearer token | Accept a pending contact request where the caller is the target user. |
| `GET` | `/v1/contacts` | user bearer token | List caller's contacts. |

## Presence

| Method | Route | Auth | Purpose |
|---|---|---|---|
| `POST` | `/v1/presence/heartbeat` | device bearer token | Record active presence for the token-bound agent instance. |

## Relay

| Method | Route | Auth | Purpose |
|---|---|---|---|
| `POST` | `/v1/relay/a2a/send` | device bearer token | Send an org-local relay task to another active agent instance. |
| `GET` | `/v1/relay/a2a/inbox` | device bearer token | Poll pending relay tasks for the token-bound agent instance. |
| `POST` | `/v1/relay/a2a/:relay_task_id/ack` | device bearer token | Acknowledge delivery for a task addressed to the token-bound agent instance. |
| `POST` | `/v1/relay/a2a/:relay_task_id/respond` | device bearer token | Respond to a task addressed to the token-bound agent instance. |
| `GET` | `/v1/relay/a2a/tasks/:relay_task_id` | device bearer token | Fetch a relay task where the token-bound agent instance is sender or receiver. |

## Transfers

| Method | Route | Auth | Purpose |
|---|---|---|---|
| `POST` | `/v1/transfers/init` | device bearer token | Initialize an approved file transfer. The request includes file name, size, and SHA-256, never local paths. |
| `PUT` | `/v1/transfers/:transfer_id/upload` | device bearer token | Upload transfer bytes from the sender agent instance. |
| `GET` | `/v1/transfers/:transfer_id/download` | device bearer token | Download transfer bytes from the receiver agent instance. |
| `POST` | `/v1/transfers/:transfer_id/receipt` | device bearer token | Record receiver verification receipt. |

## Admin

| Method | Route | Auth | Purpose |
|---|---|---|---|
| `GET` | `/v1/admin/users` | admin session or admin token | List users. |
| `GET` | `/v1/admin/devices` | admin session or admin token | List devices. |
| `GET` | `/v1/admin/agent-instances` | admin session or admin token | List agent instances. |
| `GET` | `/v1/admin/presence` | admin session or admin token | List presence. |
| `GET` | `/v1/admin/tasks` | admin session or admin token | List relay tasks. |
| `GET` | `/v1/admin/transfers` | admin session or admin token | List transfers. |
| `GET` | `/v1/admin/approvals` | admin session or admin token | List approval-related relay activity. |
| `GET` | `/v1/admin/audit` | admin session or admin token | List audit events. |
| `POST` | `/v1/admin/devices/:device_id/revoke` | admin session or admin token | Revoke a device, its device tokens, associated agent instances, and presence. |
| `POST` | `/v1/admin/users/:user_id/disable` | admin session or admin token | Disable a user and revoke their refresh/device tokens. |
| `POST` | `/v1/admin/agent-instances/:agent_instance_id/disable` | admin session or admin token | Disable an agent instance so it cannot heartbeat or poll relay. |

Admin authentication routes remain under `/v1/admin/auth/*` and are documented in `docs/admin-portal.md`.

## Security Invariants

- Device-authenticated routes must validate the bearer token signature, the token hash row, expiry, revocation state, and active user/device/agent/agent-instance status.
- Cross-org directory, relay, transfer, and agent-card access is denied by always scoping reads and writes to the authenticated org.
- Control-plane served Agent Cards must not expose local-only URLs or filesystem paths; public card URLs are derived from `CONTROL_PLANE_PUBLIC_URL`.
- Transfer APIs must never accept or return local filesystem paths. File names, sizes, hashes, transfer IDs, and storage handles are allowed.
- A local agent must not upload a file before explicit user approval binds the approval ID, task ID, selected file, local path, file name, size, SHA-256, sender, receiver, and timestamp.
- A2A extended agent cards require auth; public agent-card data must not expose internal diagnostic capabilities.
- LLM output is advisory only. Sensitive actions are controlled by deterministic route validation, policy checks, and approval state.
