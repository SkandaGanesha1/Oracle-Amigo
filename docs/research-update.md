# Research Update

Date: 2026-06-07

This note records the official references reviewed before the first code change in this pass and the assumptions the current implementation should follow. It is intentionally scoped to the present codebase state and does not claim full protocol compliance where the repo has only partial support.

## References Reviewed

- A2A Protocol v1: https://a2a-protocol.org/latest/specification/
- A2A project and SDKs: https://github.com/a2aproject/A2A, https://github.com/a2aproject/a2a-js, https://github.com/a2aproject/a2a-python
- Agent Network Protocol: https://github.com/agent-network-protocol/AgentNetworkProtocol and https://github.com/agent-network-protocol/AgentNetworkProtocol/tree/main/standard
- sqlite-vec: https://github.com/asg017/sqlite-vec and https://alexgarcia.xyz/sqlite-vec/
- Windows App SDK notifications: https://learn.microsoft.com/en-us/windows/apps/develop/notifications/app-notifications/, https://learn.microsoft.com/en-us/windows/apps/develop/notifications/app-notifications/app-notifications-content, https://learn.microsoft.com/en-us/windows/apps/develop/notifications/app-notifications/app-notifications-console
- React: https://react.dev/, https://react.dev/reference/react/useOptimistic, https://react.dev/reference/react/startTransition, https://react.dev/reference/react/useTransition, https://react.dev/reference/react/useSyncExternalStore
- TanStack Query: https://tanstack.com/query/latest/docs/framework/react/overview, https://tanstack.com/query/latest/docs/framework/react/guides/optimistic-updates, https://tanstack.com/query/latest/docs/framework/react/guides/query-invalidation
- Accessibility: https://www.w3.org/WAI/ARIA/apg/ and https://www.w3.org/WAI/WCAG22/quickref/
- Design systems and primitives: https://developer.microsoft.com/en-us/fluentui, https://ui.shadcn.com/, https://www.radix-ui.com/primitives
- Security: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html, https://cheatsheetseries.owasp.org/cheatsheets/AI_Agent_Security_Cheat_Sheet.html, https://cheatsheetseries.owasp.org/cheatsheets/MCP_Security_Cheat_Sheet.html, https://cheatsheetseries.owasp.org/cheatsheets/RAG_Security_Cheat_Sheet.html

## Implementation Assumptions

- A2A: Treat current A2A support as mixed. The repo has A2A v1 test coverage and local routes, plus compatibility surfaces for older JSON-RPC style flows. Do not claim complete A2A v1 compliance until wire payloads, agent-card fields, version/media headers, subscribe behavior, remote auth, and generated artifacts are audited against the latest v1 specification.
- A2A SDKs: Use SDK repositories as reference material, not as proof that the repo is SDK-backed. Current server behavior remains locally implemented unless code explicitly imports and exercises an SDK.
- ANP: Document this codebase as an "ANP-style identity and handshake adapter, not full decentralized ANP network compliance." Existing DID, crypto, and handshake pieces are useful, but full ANP network behavior requires additional canonical signing, registry/discovery, replay protection, expiry handling, and trust semantics.
- sqlite-vec: Treat vec0 tables and migrations as data-sensitive. Migrations must either preserve existing embeddings or deliberately invalidate them and force reindexing. Retrieval pagination should be tested after candidate selection so offset/limit behavior is correct.
- Windows notifications: Toast/app notification callbacks can be duplicated by user action or delivery behavior. Approval decisions must be enforced by DB-backed idempotency and terminal state transitions, not by UI assumptions.
- React/TanStack Query: Future UI work should stay inside the existing React/Vite app unless the architecture changes. Use a typed API layer, TanStack Query invalidation/optimistic mutation patterns, and React transition/external-store APIs only where they improve real chat, polling, or offline state behavior.
- Accessibility/design: Approval cards, directory search, message timelines, dialogs, menus, and file-transfer controls should follow WCAG 2.2 and ARIA APG patterns. Use existing components and Radix/shadcn-style primitives where they fit the current UI conventions.
- Security: Password handling should follow OWASP password storage guidance, with Argon2id already aligned with that direction. Agent, MCP, and RAG surfaces should assume untrusted tool inputs, untrusted retrieved content, strict command/network policy boundaries, and no logging of raw secrets or bearer tokens.

## Current Scope Statement

- A2A v1 is partially implemented and tested locally. Compliant pieces, compatibility-only pieces, and remaining gaps must be documented in future protocol docs before this is described as full A2A v1 compliance.
- ANP is partially implemented as local ANP-style identity, crypto, and handshake support. It is not full decentralized ANP network compliance.
- The first code change in this pass only fixes the control-plane test command behavior under `npm --prefix`; it does not implement the larger relay-first runtime, product chat UI, or protocol hardening plan.

## Phase 1/2 Update

- Local-agent control-plane wiring now follows the existing `/v1` control-plane clients and stores cloud identity in local SQLite. The implementation assumes polling relay mode via `AGENTIC_RELAY_MODE=polling`.
- The local facade routes are intentionally separate from the authoritative control-plane API: `/cloud/*` and `/relay/*` are local UI-facing routes, while `docs/api-contract.md` defines the control-plane `/v1` contract.
- Device-authenticated control-plane routes now assume DB-backed device access token hashes are present for newly enrolled devices. Revocation is enforced by token row state plus active `users`, `devices`, `agents`, and `agent_instances` status.
- Remote file requests are dispatched into the existing local file-search approval workflow. This preserves the security rule that no file transfer occurs before explicit approval and does not put local file paths in relay payloads.

## Phase 3.4/3.5/3.6/4 Update

Date: 2026-06-08

Additional reference assumptions used for the chat frontend and file-request workflow:

- React 19.2 `useOptimistic` remains appropriate for transient UI state, but optimistic setters should run inside actions/transitions. This pass uses TanStack Query optimistic mutation cache updates and local reducer updates rather than introducing `useOptimistic` in a way that would violate that constraint.
- TanStack Query v5 query invalidation is the primary server-state refresh mechanism. Polling is implemented through a `RealtimeTransport` abstraction with `PollingTransport` now and explicit `SseTransport`/`WebSocketTransport` placeholders for later server-push work.
- A2A v1 JSON payloads should use camelCase on the wire. Existing local relay facades still accept snake_case local API parameters because they are UI-facing compatibility routes; relay payload content now includes camelCase `requestText` alongside existing local fields.
- A2A file requests remain represented as asynchronous tasks requiring human approval. The current implementation is relay-compatible and approval-gated, but it is not a full end-to-end A2A transfer-completion implementation across two live laptops yet.
- ARIA/WCAG assumptions applied: command palette uses dialog semantics, message timeline uses log/live-region semantics, icon-only buttons keep accessible labels via titles/ARIA labels, and approval actions are real keyboard-focusable buttons.
- Local chat persistence now uses `conversations`, `conversation_participants`, `chat_messages`, `message_delivery_attempts`, and `outbox`. The older `messages` table remains for compatibility with existing memory APIs.
- Security boundary maintained: remote peers and cloud relay payloads must not receive local file paths. Chat timeline approval candidate payloads use display paths and privacy labels; approval binding can still store local file paths in local SQLite for approval/hash enforcement.

## Phase 5/6/7 Update

Date: 2026-06-08

Additional implementation assumptions:

- A2A v1 HTTP routes use public colon verbs through the existing Fastify URL rewriter. `POST /v1/tasks/:id:subscribe` is covered by tests and maps internally to `/v1/tasks/subscribe/:id`.
- A2A v1 push notification config responses emit `taskPushNotificationConfig`. Legacy `pushNotificationConfig` input is accepted for backward compatibility but is not emitted by v1 HTTP responses.
- A2A v1 generated payloads use member-based `text`/`file`/`data` parts and do not include a runtime `kind` discriminator.
- Agent Card signatures use canonical JSON of the unsigned card payload, with `signatures` excluded, and JOSE protected header `typ`.
- Extended Agent Card access now requires a bearer-style Authorization header. Remote A2A route protection is option-driven so local development remains compatible while cloud/remote mode can require bearer/device/relay token validation and tenant checks.
- ANP handshake signing now uses canonical JSON over the full snake_case payload: `protocol`, `offer_id`, `from_agent_id`, `from_agent_instance_id`, `from_did`, `to_peer`, `nonce`, `created_at`, and `expires_at`.
- ANP remains "ANP-style identity and handshake adapter, not full decentralized ANP network compliance." Full decentralized discovery, production DID-WBA resolver behavior, full E2E ANP messaging, and marketplace/open-network behavior are still out of scope.
- sqlite-vec migration now preserves compatible old vec0 embeddings by staging rowid and embedding data, recreating partitioned vec0 tables, reinserting compatible rows, and dropping staging tables.
- Hybrid retrieval pagination now ranks enough candidates for `offset + limit`, then returns `slice(offset, offset + limit)` to keep MMR pagination stable and non-overlapping.

## Phase 8-13 Update

Date: 2026-06-08

Additional official references rechecked:

- A2A latest specification: https://a2a-protocol.org/latest/specification/
- A2A project repository: https://github.com/a2aproject/A2A
- Agent Network Protocol repository: https://github.com/agent-network-protocol/AgentNetworkProtocol
- sqlite-vec repository: https://github.com/asg017/sqlite-vec
- React transition API: https://react.dev/reference/react/useTransition
- TanStack Query optimistic updates: https://tanstack.com/query/latest/docs/framework/react/guides/optimistic-updates
- WCAG 2.2 quick reference: https://www.w3.org/WAI/WCAG22/quickref/
- OWASP AI Agent Security Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/AI_Agent_Security_Cheat_Sheet.html

Implementation assumptions applied:

- Approval callback safety follows the Windows notification assumption above: DB-backed idempotency and terminal approval transitions are required because notification callbacks can repeat.
- Admin revocation is deterministic and DB-backed. Device revoke revokes device tokens and associated agent instances; agent-instance disable blocks relay polling because device-auth middleware validates instance status.
- Production admin setup must be explicitly enabled with `ADMIN_SETUP_ENABLED=true`; otherwise setup is guarded even when no admin exists.
- Frontend workflow tests use the repo's current stable test tool, Vitest, to verify source/build contracts. Browser-level Playwright coverage remains recommended but not stable in this local environment.
- The relay-first E2E harness validates relay-first behavior with automatic local-runtime approval-to-cloud-transfer handoff: Bob approval uploads through the cloud relay, Alice downloads, verifies SHA-256, stores the file locally, and records receipt.

## Two-Device Readiness Verification Update

Date: 2026-06-08

Official references rechecked for this hardening pass:

- A2A latest specification: https://a2a-protocol.org/latest/specification/
- A2A repository specification: https://github.com/a2aproject/A2A/blob/main/docs/specification.md
- Windows App Notifications for .NET apps: https://learn.microsoft.com/en-us/windows/apps/develop/notifications/app-notifications/app-notifications-dotnet
- sqlite-vec vec0 virtual table docs: https://alexgarcia.xyz/sqlite-vec/features/vec0.html

Repository reality after verification:

- A2A v1 alignment remains test-backed for the locally implemented surfaces: colon-verb task subscribe, `taskPushNotificationConfig` response shape, protected extended cards, signed agent cards, relay-reachable card advertising, and no v1 runtime `kind` part discriminators in generated payloads.
- The repo should still describe ANP as an "ANP-style hardened handshake adapter" unless/until full decentralized ANP discovery and production network messaging are implemented. The present codebase has DID/handshake hardening tests, not a complete ANP network stack.
- sqlite-vec assumptions remain unchanged: migrations must preserve compatible vec0 rows or force reindexing, and hybrid retrieval pagination must apply after final ranking/MMR with `slice(offset, offset + limit)`.
- Windows notification approval behavior must continue to assume duplicate callbacks and repeated user actions. The implementation is expected to rely on DB-backed idempotency and terminal approval states, not UI-only callback suppression.
- Relay-first two-device readiness is now verified by the dedicated E2E command, which exercises signup, enrollment, heartbeat, directory, relay task delivery, approval promotion, relay transfer, SHA-256 receipt, and admin task/transfer/audit visibility.
- Local/offline compatibility is preserved: loopback tests now use dynamic ports by default, but explicit ports are still accepted for compatibility scripts and manual demos.

## Two-Device Card Hardening Update

Date: 2026-06-08

Implementation assumptions applied:

- The public A2A subscribe contract remains `POST /v1/tasks/{id}:subscribe`. The internal Fastify rewrite path is retained only as a compatibility route.
- Agent Card signing now uses a stricter JCS-style canonical JSON helper that excludes top-level `signatures`, rejects unsupported JSON values, recursively sorts object keys, and preserves array order.
- Control-plane served Agent Cards are relay-facing views of stored local cards. They rewrite HTTP+JSON URLs from local agent URLs to `CONTROL_PLANE_PUBLIC_URL`, strip existing signatures, sanitize local-only URLs/paths, and re-sign only when `AGENT_CARD_SIGNING_PRIVATE_KEY_PEM` is configured.
- Directory agent rows now carry `relay_inbox_url`, `agent_card_url`, and `agent_card_hash`, all scoped to the authenticated organization and derived from `CONTROL_PLANE_PUBLIC_URL`.
