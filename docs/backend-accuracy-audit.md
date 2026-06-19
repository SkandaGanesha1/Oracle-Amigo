# Backend Accuracy Audit

Date: 2026-06-18
Commit reviewed: `727ba20f1e3a144d034003cacb606bb1248b9982`

## Scope

This audit reviewed the backend, control-plane, admin portal adapter, admin UI API integration, and backend-facing tests as one production system.

Source families reviewed:

- Local agent backend: `src/**/*.ts`, with emphasis on `src/server.ts`, `src/chat/`, `src/runtime/`, `src/voice/`, `src/cloud/`, `src/enrollment/`, `src/storage/`, `src/agent-runs/`, `src/memory/`, `src/policy/`, `src/retrieval/`, `src/intent/`, `src/workflow/`, `src/protocol/`, `src/registry/`, and `src/security/`.
- Control plane: `apps/control-plane/src/**/*.ts`.
- Admin adapter: `apps/admin-portal/src/**/*.ts`.
- Admin UI backend API layer: `ui-admin/src/portal/api/**/*.ts`.
- Backend-facing tests: `tests/**/*.test.ts`, `apps/control-plane/tests/**/*.test.ts`, `apps/admin-portal/tests/**/*.test.ts`, and E2E scripts under `scripts/`.
- Contract docs: `docs/api-contract.md`, `docs/security-model.md`, `docs/control-plane-architecture.md`, `docs/admin-portal.md`, and `docs/frontend-chat-architecture.md`.

Generated bundles and build output were not line-reviewed. They were verified by build commands.

Research anchors used for the audit: OWASP API Top 10 2023, OWASP ASVS 5.0.0, Fastify production recommendations, OpenAI agent guidance, MCP security guidance, and OpenAI Apps security/privacy guidance.

## Verification Commands

| Command | Result | Notes |
|---|---|---|
| `npm.cmd run typecheck` | Pass | Server and UI TypeScript checks passed after the boundary fixes. |
| `npm.cmd test` | Pass | Root Vitest suite passed after the boundary fixes: 48 files passed, 389 tests passed, 1 skipped. |
| `npm.cmd run test:ui` | Pass | UI Vitest suite passed: 10 files, 118 tests. Existing realtime warning is expected coverage for wildcard invalidation. |
| `npm.cmd run build` | Pass | TypeScript and Vite build passed. Vite reported the existing large chunk warning. |
| `npm.cmd run test:control-plane` | Pass | 4 files, 42 tests. Covers auth, enrollment, relay, transfer, admin hardening. |
| `npm.cmd run build:control-plane` | Pass | Control-plane `tsc` passed. |
| `npm.cmd run test:admin-portal` | Pass | 1 file, 7 tests. Covers health, proxy, cookie forwarding, SPA fallback, 404. |
| `npm.cmd run build:admin-portal` | Pass | Admin adapter `tsc` passed. |
| `npm.cmd test -- tests/BackendSecurityHardening.test.ts tests/voice-file-request-flow.test.ts tests/AgenticFacadeEndpoints.test.ts` | Pass | Focused verification for the fixed Quick Voice, receiver approval, and intent local boundaries plus voice file-request and agentic facade flows. |
| `npm.cmd run test:e2e:relay` | Pass | Two-agent relay file-request E2E passed. |
| `npm.cmd run test:e2e:relay-message` | Pass | Peer routing and chat persistence relay tests passed. |
| `npm.cmd run test:e2e:relay-message-live` | Pass | Two-agent live relay message E2E passed without hard refresh. |
| `npm.cmd run test:e2e:relay-file-search` | Pass | File request parser/search plus chat persistence passed. |
| `npm.cmd run test:e2e:voice-file-request` | Pass | Quick Voice file request flow passed. |

## Gaps Found And Fixed

### Quick Voice routes lacked the local-agent route guard

- Evidence: `src/voice/VoiceCommandRoutes.ts` registered `/voice/status`, `/voice/commands`, command detail/history/events, confirm, cancel, and transcribe without route options. These routes can create/confirm relay file requests, so they must share the same local-agent boundary as chat, relay, memory, files, policy, and missions.
- Root cause: the voice route registrar did not accept a Fastify route options object, so `src/server.ts` could not pass the existing `localOnly` pre-handler into `/voice/*`.
- Fix: `registerVoiceCommandRoutes()` now accepts `RouteShorthandOptions`, and `src/server.ts` registers Quick Voice routes with `localOnly`.
- Test: `tests/BackendSecurityHardening.test.ts` now asserts unauthenticated `/voice/*` requests return `401` when `LOCAL_AGENT_API_TOKEN` is configured. The existing voice file-request flow still passes in test mode.

### Receiver approval routes lacked the local-agent route guard

- Evidence: `src/runtime/ReceiverApprovalRoutes.ts` registered `/receiver/approvals`, detail, approve, and reject without route options. The approve route accepts a selected local file path and initiates a transfer, so it must share the same local-agent boundary as other approval and file routes.
- Root cause: the receiver approval route registrar did not accept a Fastify route options object.
- Fix: `registerReceiverApprovalRoutes()` now accepts `RouteShorthandOptions`, and `src/server.ts` registers receiver approval routes with `localOnly`.
- Test: `tests/BackendSecurityHardening.test.ts` now asserts unauthenticated receiver approval requests return `401` when `LOCAL_AGENT_API_TOKEN` is configured. `npm.cmd run test:e2e:relay` and `npm.cmd run test:e2e:voice-file-request` still pass.

### Intent helper routes lacked the local-agent route guard

- Evidence: `/intent/classify` and `/intent/rewrite` accept user text and feed deterministic agentic helper services. They are backend facades for the local UI and should not be callable without the local UI session/API-token boundary.
- Root cause: the two routes were registered without `localOnly`.
- Fix: `src/server.ts` now registers both intent helper routes with `localOnly`.
- Test: `tests/BackendSecurityHardening.test.ts` now asserts unauthenticated intent helper requests return `401` when `LOCAL_AGENT_API_TOKEN` is configured. `tests/AgenticFacadeEndpoints.test.ts` still passes in test mode.

## Documentation Drift Fixed

- `docs/api-contract.md` now includes `/agent-profiles`, `/voice/*`, admin info, and admin org snapshot routes.
- `docs/security-model.md` now records the Quick Voice, receiver approval, and intent local boundaries plus production secret requirements.
- `docs/control-plane-architecture.md` now documents current `/v1/*` control-plane routes instead of older non-versioned endpoint names.
- `docs/admin-portal.md` no longer claims all admin data surfaces are read-only; it documents the current revoke/disable admin actions.

## Endpoint Matrix

| Area | Representative routes | Auth boundary | Control-plane dependency | Admin visibility | Test coverage |
|---|---|---|---|---|---|
| Health/UI session | `GET /health`, `GET /local-ui-session` | public local bootstrap; signed HttpOnly UI session cookie issued by app shell | none | health only | `BackendSecurityHardening.test.ts`, builds |
| Local profile/settings | `GET /profile`, `POST /profile/init`, `GET/PUT /settings/user-agent` | local UI session or local API token | none | not exposed | root tests, UI tests |
| Chat | `GET/POST /chat/conversations`, `GET/POST /chat/conversations/:id/messages`, read-state, reactions, threads | local UI session or local API token | relay path uses control-plane directory/relay | relay task/admin views indirectly | `ChatPersistence.test.ts`, `PeerRouting.test.ts`, live E2E |
| Realtime | `GET /events`, chat repository events | local UI session or local API token | local projection over control-plane-backed state | no raw stream in admin | UI realtime tests, live E2E |
| Quick Voice | `GET /voice/status`, `POST /voice/commands`, history/detail/events/confirm/cancel | local UI session or local API token | optional directory/relay for confirmed remote file request | relay/admin views after submission | `voice-command-*`, `voice-file-request-flow.test.ts`, `BackendSecurityHardening.test.ts` |
| Files/search/storage | `/files/*`, `/storage/files/*`, `/transfers` | local UI session or local API token | transfer init/upload/download/receipt for remote file sharing | transfers visible without file bytes/paths | `FileRequestSearch.test.ts`, `ChatPersistence.test.ts`, relay E2E |
| Approvals | `/approvals/*`, `/api/inbox/*`, notification callback | local API token for approval API, local UI for inbox; callback signature for OS notification | transfer upload after approval | approval-related relay activity | `ChatPersistence.test.ts`, voice E2E |
| Memory/intent/policy | `/memory/*`, `/intent/*`, `/policy/*` | local UI session/API token for memory, intent helpers, and policy | none | not exposed | root tests and UI hardening |
| Agent profiles/registry/skills | `/agent-profiles`, `/registry/*`, `/skills` | local UI/API token for mutations and agent profiles; public discovery reads where intended | directory/contacts for agent profile join | registry not admin-owned | frontend hardening and root tests |
| A2A/ANP protocol | `/a2a/*`, `/v1/message_*`, `/anp/handshake/*`, `.well-known/*` | protocol-specific public discovery and message boundaries; local-only for sensitive local ANP actions | relay only through local facade/control plane | relay tasks visible | A2A, ANP, relay tests |
| Sandbox/agent runs | `/sessions/*`, `/agent/runs/*`, `/agent/files/*` | local API token | none | not exposed | agent run tests |
| Control-plane auth/enrollment | `/v1/auth/*`, `/v1/enrollment/complete`, `/v1/devices/me`, `/v1/agents/me` | user bearer, refresh token body, or device bearer depending route | source of truth | users/devices/instances visible | control-plane tests |
| Control-plane directory/contacts/presence | `/v1/directory/*`, `/v1/contacts/*`, `/v1/presence/heartbeat` | user/device bearer scoped to org | source of truth | admin presence/users/devices | control-plane tests, relay E2E |
| Control-plane relay/transfers | `/v1/relay/a2a/*`, `/v1/transfers/*` | device bearer scoped to sender/receiver org and agent instance | source of truth | tasks/transfers/audit/approvals | control-plane tests, relay E2E |
| Admin auth/actions | `/v1/admin/auth/*`, `/v1/admin/*` | admin session cookie or bootstrap/admin token where allowed | direct control-plane | admin UI | admin auth/hardening/admin portal tests |
| Admin adapter | `GET /health`, `/v1/*` proxy, SPA fallback | adapter forwards cookies/Set-Cookie; auth enforced upstream | control plane | serves admin UI | admin portal tests |

## Production Blockers

- External production deployment still needs real TLS/reverse-proxy configuration, production secrets, and environment-specific smoke tests.
- Production relay-token semantics should be tested with real deployment credentials before external exposure.
- Browser accessibility E2E coverage is still listed as a known gap in `docs/security-model.md`.
- Vite reports the current chat bundle exceeds the default 500 kB chunk warning; this is not a correctness failure, but it is a launch performance risk.
- `public/` and admin static output are generated artifacts and should be rebuilt, not hand-edited, during release packaging.

## Recommended Next PRs

1. Add a route-inventory contract test that compares local/control-plane route registration against `docs/api-contract.md`.
2. Add production smoke scripts for TLS reverse proxy, admin cookie prefix, relay task delivery, and transfer receipt with real deployment credentials.
3. Add Playwright accessibility and keyboard-flow coverage for auth, chat, inbox, approval, and admin portal.
4. Split the largest chat UI chunks with route-level dynamic imports.
5. Add an operator audit event for each admin revoke/disable action if not already emitted by the control-plane service layer.
