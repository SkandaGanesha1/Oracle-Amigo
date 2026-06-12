# Oracle Amigo

Oracle Amigo is a local-first personal-agent app with a cloud relay. A user signs up, enrolls a device-bound local agent, searches same-org people, chats through the control plane, and can request files through A2A-style tasks that require explicit local approval before transfer.

## Architecture

- Local Agent: single-user, device-bound Fastify service on `127.0.0.1` by default. It owns local SQLite/sqlite-vec memory, indexed files, approval workflow, chat persistence, notification callbacks, and local storage.
- Agentic Chat UI: React/Vite chat app in `ui/`, built into `public/`. It provides auth, enrollment, directory, conversations, file-request detection, approvals, received files, audit, diagnostics, and settings.
- Control Plane: multi-tenant Fastify app in `apps/control-plane`. It owns auth, enrollment, directory, contacts, presence, A2A relay, file transfers, audit, and admin APIs.
- Admin Portal: adapter in `apps/admin-portal` plus React UI in `ui-admin`. It provides admin auth, monitoring, revocation, and audit views without file bytes or local paths.
- Windows Notification Bridge: `apps/notification-bridge-windows`, used for local approval notifications and callbacks.

## Requirements

- Node.js `>=24`
- npm
- Optional: Windows App SDK/.NET tooling for the notification bridge

## Install And Check

```bash
npm install
npm run typecheck
npm test
npm run build
```

## Single-Device Mode

```bash
npm run dev
npm run dev:ui
```

Open `http://127.0.0.1:3399/` for the local agent UI, or the Vite URL from `npm run dev:ui`.

## Control Plane

```bash
npm run dev:control-plane
```

Important environment variables:

```text
CONTROL_PLANE_URL=http://127.0.0.1:8080
CONTROL_PLANE_DB_PATH=./data/control-plane.db
JWT_ACCESS_SECRET=change-this
JWT_REFRESH_SECRET=change-this
ADMIN_KEK=change-this-32-chars-min
```

## Local Agent Cloud Mode

```bash
CONTROL_PLANE_URL=http://127.0.0.1:8080 \
AGENTIC_PROFILE_ID=alice \
AGENTIC_DB_PATH=./data/alice.db \
AGENTIC_STORAGE_ROOT=./data/alice-storage \
SANDBOX_PORT=3399 \
npm run dev
```

Use the UI or local APIs:

- `POST /cloud/signup`
- `POST /cloud/login`
- `POST /cloud/enroll`
- `GET /cloud/status`
- `GET /cloud/directory/users?q=`
- `POST /relay/send-file-request`

## Admin Portal

```bash
npm run dev:admin-portal
```

Admin auth is separate from normal user auth. Admin APIs reject normal user tokens. Admin sessions use HttpOnly cookies, TOTP secrets are encrypted at rest, and recovery codes are hashed.

## Windows Notification Bridge

```bash
npm run dev:notification-bridge
```

Approval callbacks are now DB-backed in the local agent. Duplicate approve/reject callbacks are idempotent and terminal approvals cannot be reversed.

## Two-Agent Relay E2E

```bash
npm run test:e2e:relay
npm run test:e2e:relay-message
npm run test:e2e:relay-file-search
```

This starts a control plane and two separate local-agent processes, enrolls Alice and Bob, sends a relay file request, creates Bob's approval card, approves it, completes a control-plane file transfer, verifies SHA-256, and checks admin task/transfer/audit visibility.

`test:e2e:relay-message` focuses on normal chat relay hardening: stale peer-agent routes are repaired to the current online user agent, receiver-side `message.send` items are written into the chat timeline before ack, failed dispatches are left unacked for retry, and sender messages advance through relay delivery states.

`test:e2e:relay-file-search` covers the remote file-request search path: exact filename parsing, filename-first indexed lookup, live allowed-root fallback when the SQLite index is empty, refinement/manual binding, and bound approval creation without exposing raw local paths.

## Remote File Request Search

Remote relay file requests use the same safe local roots as the local agent search. The receiver parses exact filenames from text such as `Send me Job Offer-Associate Consultant.pdf file`, checks filename-first indexed matches, falls back through hybrid retrieval, then uses live `FileSearchService` search over configured roots if the index is empty. Search diagnostics are available at `GET /files/search/debug?query=...` and return parser output, candidate reasons, searched roots, and safe display fields only.

If no file is found, the receiver creates a `file.search.refinement` approval state rather than a transferable approval. The owner can search again with feedback or choose an indexed file manually; `/approvals/:id/rebind-file` hashes and binds the selected file before converting it into `file.transfer.offer`. `/approvals/:id/approve` rejects unbound transfer/refinement approvals with `APPROVAL_HAS_NO_BOUND_FILE`.

Sender-side chat status is relayed back as lightweight `file.request.status` messages: request delivered, receiver searching, no candidate/refinement needed, waiting for approval, transfer starting, and file received/hash verified.

## Chat Presence And Delivery

Cloud chat routes people by stable `peer_user_id` first and treats `peer_agent_instance_id` as a refreshable active device target. `PeerRoutingService` repairs stale conversations before relay send by resolving the peer user's current online agent with the required capability.

Relay acceptance is not treated as final delivery. Cloud sends now store `queued_at_relay`, then `/relay/task/:relay_task_id/status` maps control-plane task state into `delivered_to_remote_agent`, `stored_by_remote_agent`, or `failed`. `sent` and `delivered` remain readable legacy/local statuses.

The chat UI normalizes peer presence into `Online`, `Stale`, `Offline`, `Presence unavailable`, and `Old agent route - switch to current agent`, so unknown directory data is not shown as a false offline state.

## A2A v1 Status

Implemented/covered:

- Agent Card v1 shape with `supportedInterfaces`
- no emitted v1 `kind` discriminator in tested payloads
- `POST /v1/tasks/:id:subscribe` compatible route
- `taskPushNotificationConfig` emitted, legacy input accepted
- canonical Agent Card signing excluding signatures, `typ: "JOSE"`
- Extended Agent Card auth
- remote route auth hook for bearer/device/relay-style validation

Compatibility-only or remaining:

- A2A relay payloads are practical app messages/tasks, not a full independent A2A conformance suite.
- End-to-end remote A2A auth should be tested against production relay tokens before deployment.

## ANP Status

Implemented: local DID/keypair plus hardened handshake adapter that signs canonical full payloads, validates expiry, prevents replay, binds peer identity to `agent_instance_id`, and persists peer sessions.

Not implemented: full decentralized ANP network compliance, DID-WBA production resolver, full E2E ANP messaging, marketplace/open-network discovery.

## sqlite-vec And Retrieval

The local agent uses FTS5 plus sqlite-vec when available. The vec0 migration preserves compatible embeddings or forces reindex behavior where needed, and hybrid retrieval pagination now slices `offset..offset+limit` after ranking/MMR.

## Security Model

- No file transfer before explicit approval.
- Approval binds approval/task/file metadata, size, SHA-256, participants, and timestamp.
- Remote peers and cloud never receive local file paths.
- Passwords use Argon2id.
- Refresh/device tokens are hashed server-side.
- Revoked/disabled devices and agent instances cannot heartbeat, poll relay, or transfer.
- Cross-org directory/relay access is denied by org-scoped auth checks.
- LLM output is not allowed to directly execute sensitive actions.

## Known Limitations

- Bob approval now triggers cloud relay upload/download/receipt in the local runtimes; the relay E2E verifies this without manual transfer calls in the harness.
- Browser-level Playwright verification is not part of the normal suite; frontend workflow coverage currently uses Vitest source/build contract tests.
- The skipped legacy `tests/TwoLaptopE2E.test.ts` still includes direct-agent compatibility coverage and is not the relay-first acceptance harness.

## Next Production Hardening

- Replace dev/admin bootstrap paths with production operator setup procedure.
- Add full browser E2E with Playwright once the local browser environment is stable.
- Add SSE/WebSocket transport behind the existing realtime abstraction.
- Add production key rotation, TLS deployment, monitoring, and backup procedures.
