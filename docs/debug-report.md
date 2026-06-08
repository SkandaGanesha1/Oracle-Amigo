# Debug Report

Date: 2026-06-07

## Scope

This report covers the requested first task plus the Phase 1/2 changes completed in this pass: inspect the repo, read the key package/project files, run the required checks, fix failures, wire the local agent to the control plane, document the `/v1` API contract, and record the result.

## Repo Inspection

Inspected the repository structure and key manifests:

- `package.json`
- `apps/control-plane/package.json`
- `apps/admin-portal/package.json`
- `apps/notification-bridge-windows/NotificationBridge.csproj`

Observed major code areas:

- Root local agent/server code under `src/`
- React chat UI under `ui/`, generated build output under `public/`
- Admin control-plane services under `apps/control-plane/`
- Admin portal adapter under `apps/admin-portal/`
- Standalone admin UI under `ui-admin/`
- Windows notification bridge under `apps/notification-bridge-windows/`
- Vitest suites under `tests/` and app-level `tests/`

## Commands Run

Root commands:

- `npm.cmd install` - passed. Output reported packages were up to date, 235 packages audited, 1 critical severity vulnerability, and pending `allow-scripts` warnings for `esbuild@0.28.0`, `ssh2@1.17.0`, and `esbuild@0.27.7`.
- `npm.cmd run typecheck` - passed.
- `npm.cmd test` - passed: 36 test files passed, 1 skipped; 262 tests passed, 1 skipped.
- `npm.cmd run build` - passed. Vite generated `public/index.html`, `public/assets/index-DklYHqEg.css`, and `public/assets/index-CiIfF4s8.js`.

Control-plane commands:

- `npm.cmd --prefix apps/control-plane run typecheck` - passed.
- `npm.cmd --prefix apps/control-plane test` - failed before the first fix; passed after the fix with 3 test files and 25 tests passing.
- `npm.cmd --prefix apps/control-plane run build` - passed.

Admin-portal commands:

- `npm.cmd --prefix apps/admin-portal run typecheck` - passed.
- `npm.cmd --prefix apps/admin-portal test` - passed with 1 test file and 7 tests passing.
- `npm.cmd --prefix apps/admin-portal run build` - passed.

Additional diagnostic commands:

- `npm.cmd test` from `apps/control-plane` - passed, confirming the control-plane tests themselves were valid.
- `node scripts/run-vitest.mjs` from `apps/control-plane` - used while debugging the wrapper behavior.
- `git status --short` - showed generated public asset churn and the control-plane test-script change.

## Phase 1/2 Changes

Implemented local-agent control-plane wiring:

- Added local cloud identity persistence in SQLite.
- Added local facade routes:
  - `POST /cloud/signup`
  - `POST /cloud/login`
  - `POST /cloud/logout`
  - `POST /cloud/enroll`
  - `GET /cloud/status`
  - `GET /cloud/me`
  - `GET /cloud/directory/users?q=`
  - `GET /cloud/contacts`
  - `POST /cloud/contacts/request`
  - `POST /cloud/contacts/:contact_id/accept`
  - `GET /relay/inbox/status`
  - `POST /relay/send-message`
  - `POST /relay/send-file-request`
- Added enrollment/runtime services:
  - `src/enrollment/DeviceEnrollmentService.ts`
  - `src/enrollment/AgentRegistrationService.ts`
  - `src/runtime/HeartbeatService.ts`
  - `src/runtime/InboxPoller.ts`
  - `src/runtime/RemoteTaskDispatcher.ts`
- Remote file-request relay tasks are converted into existing local file-search approval workflow tasks.
- Local relay send-file-request payloads include request text and task metadata only, not local filesystem paths.

Implemented control-plane consistency/security changes:

- Added `docs/api-contract.md` as the authoritative `/v1` control-plane route contract.
- Added requested root scripts for control-plane/admin build/test/dev/start commands and `build:all`.
- Device access tokens are now persisted by hash during enrollment.
- `requireDeviceAuth()` now checks the bearer token hash, expiry, revocation state, and active user/device/agent/agent-instance status before allowing heartbeat, relay, transfer, or agent-card requests.

## Exact Failure

The failing required command was:

```powershell
npm.cmd --prefix apps/control-plane test
```

The exact startup failure was:

```text
failed to load config from C:\Users\Skanda Ganesha L\Desktop\Oracle_Amigo\apps\control-plane\vitest.config.ts

Error: Build failed with 2 errors:
error: Cannot read directory "../../../..": Access is denied.
error: Could not resolve "C:\\Users\\Skanda Ganesha L\\Desktop\\Oracle_Amigo\\apps\\control-plane\\vitest.config.ts"
```

After adding an ESM config, the same esbuild config-loading path failed similarly for `vitest.config.mjs` until the Vitest config loader was changed:

```text
failed to load config from C:\Users\Skanda Ganesha L\Desktop\Oracle_Amigo\apps\control-plane\vitest.config.mjs

Error: Build failed with 2 errors:
error: Cannot read directory "../../../..": Access is denied.
error: Could not resolve "C:\\Users\\Skanda Ganesha L\\Desktop\\Oracle_Amigo\\apps\\control-plane\\vitest.config.mjs"
```

## Root Cause

The control-plane tests passed when run from `apps/control-plane`, but `npm --prefix apps/control-plane test` launched the package script from the repo-root command context. In this managed filesystem environment, Vitest's default bundled config loader delegated to Vite/esbuild and attempted an upward directory read outside the allowed area while resolving the subpackage config.

This was a command invocation/config-loading issue, not a failing control-plane test or TypeScript build issue.

## Fix

Changed the control-plane package test command to run through a package-local Node wrapper:

- `apps/control-plane/package.json`
- `apps/control-plane/scripts/run-vitest.mjs`
- `apps/control-plane/vitest.config.mjs`

The wrapper:

- Resolves the control-plane package root from `import.meta.url`.
- Runs Vitest through `node node_modules/vitest/vitest.mjs`.
- Sets `cwd`, `INIT_CWD`, `PWD`, and `npm_config_prefix` to the package root.
- Uses `--configLoader runner` so Vitest loads the package config without the failing esbuild-bundled config path.

No generated output was hand-edited. `npm run build` regenerated current Vite assets under `public/`.

## Verification After Fix

These commands passed after the fix:

- `npm.cmd --prefix apps/control-plane test`
- `npm.cmd --prefix apps/control-plane run typecheck`
- `npm.cmd --prefix apps/control-plane run build`
- `npm.cmd run typecheck`
- `npm.cmd test`
- `npm.cmd run build`
- `npm.cmd --prefix apps/admin-portal run typecheck`
- `npm.cmd --prefix apps/admin-portal test`
- `npm.cmd --prefix apps/admin-portal run build`

Final root test summary:

```text
Test Files  36 passed | 1 skipped (37)
Tests       262 passed | 1 skipped (263)
```

Final control-plane test summary:

```text
Test Files  3 passed (3)
Tests       25 passed (25)
```

Final admin-portal test summary:

```text
Test Files  1 passed (1)
Tests       7 passed (7)
```

## Phase 3 Frontend Update

Implemented the modern chat frontend in the existing `ui/` app only. `ui-admin/` was not modified.

Frontend changes completed:

- Replaced the older prompt-box shell with an agentic chat app surface.
- Added auth/signup/login screen with org slug, display name, password, and control-plane URL.
- Added device enrollment screen with device fingerprint, agent display name, capabilities, enrollment action, and heartbeat status.
- Added a desktop three-pane chat layout with sidebar, conversation timeline, and right details panel.
- Added directory search, conversation list, message composer, command suggestions, approval center, received files, audit timeline, settings, diagnostics/status pills, and command palette.
- Added typed frontend message/data models and a typed API client for local cloud, relay, approvals, files, and audit endpoints.
- Added TanStack Query provider and query/mutation usage for server state.
- Added virtualized message list via `@tanstack/react-virtual`.
- Added optimistic local sends, failed-send retry state, and offline outbox visibility.
- Added approval/file/transfer/privacy card UI elements that avoid exposing local file paths.

Phase 3 files changed:

- `ui/index.html`
- `ui/src/App.tsx`
- `ui/src/api/client.ts`
- `ui/src/main.tsx`
- `ui/src/styles.css`
- `ui/src/types.ts`
- `tests/Ui.test.ts`
- `tests/admin-ui-build.test.ts`
- Generated by build: `public/index.html`, `public/assets/index-C-m0KQkJ.css`, `public/assets/index-BM6yrPKi.js`

Phase 3 commands run:

- `npm.cmd run typecheck` - passed.
- `npm.cmd run build` - passed. Vite generated `public/index.html`, `public/assets/index-C-m0KQkJ.css`, and `public/assets/index-BM6yrPKi.js`.
- `npm.cmd test` - passed: 36 test files passed, 1 skipped; 262 tests passed, 1 skipped.

Phase 3 browser verification attempts:

- The in-app Browser connector failed twice during setup with a Windows sandbox setup failure.
- Playwright CLI initially failed in the sandbox with npm cache `EPERM`; rerunning outside the sandbox allowed the command to execute, but the CLI variant did not return a useful snapshot/output in this environment.
- `npx --package playwright node -e ...` and `npm exec --package=playwright -- node -e ...` both failed to resolve `require("playwright")` on this Windows/npm setup.
- The temporary localhost server health endpoint was verified during the bounded smoke-test commands, and each attempted server process was stopped in the same command.

Phase 3 remaining limitation:

- Browser-level visual verification is blocked by the local browser automation environment. Static serving, bundle inspection, TypeScript, production build, and the root Vitest suite all pass.

## Phase 3.4/3.5/3.6/4 Chat Workflow Update

Implemented the requested component/API/data-model workflow in the existing `ui/` and local-agent code paths. `ui-admin/` was not modified.

Frontend changes completed:

- Added named component exports for the requested chat surface components, including auth, enrollment, sidebar, directory search, conversation list, timeline bubbles, approval cards, transfer cards, received files, audit, diagnostics, settings, error boundary, and toast provider.
- Split the frontend API layer into typed modules under `ui/src/api/`:
  - `localAgentClient.ts`
  - `cloudAuthApi.ts`
  - `cloudDirectoryApi.ts`
  - `chatApi.ts`
  - `relayApi.ts`
  - `approvalsApi.ts`
  - `filesApi.ts`
  - `auditApi.ts`
  - `types.ts`
- Added TanStack Query hooks under `ui/src/hooks/queries.ts` for cloud status, profile, directory, contacts, conversations, messages, send-message, send-file-request, approvals, received files, audit, diagnostics, and polling refresh.
- Added `RealtimeTransport`, `PollingTransport`, `SseTransport`, and `WebSocketTransport` abstractions under `ui/src/realtime/RealtimeTransport.ts`. Polling is used now; WebSocket is not hardcoded.
- Routed the chat UI send path through persisted `/chat/conversations/:id/messages` APIs. File-request sends create the local timeline record first and then dispatch through the relay/file-request flow.

Backend/local-agent changes completed:

- Added `src/chat/ChatRepository.ts`.
- Added/adapted local chat tables:
  - `conversations`
  - `conversation_participants`
  - `chat_messages`
  - `message_delivery_attempts`
  - `outbox`
- Added migration repair logic for existing `conversations` tables and created new chat tables during startup migrations.
- Added persisted chat APIs:
  - `POST /chat/conversations`
  - `GET /chat/conversations`
  - `GET /chat/conversations/:id/messages`
  - `POST /chat/conversations/:id/messages`
- Integrated relay file requests with persisted timeline messages and approval-card payloads.
- Updated `RemoteTaskDispatcher` so inbound relay file-request tasks create a local cloud-relay conversation, append B-side task/search/approval timeline messages, and preserve the privacy boundary.
- Approval approve/reject/feedback routes now append visible timeline events and transfer/update cards for the related conversation where available.

Security behavior preserved in this phase:

- File transfer is still approval-gated.
- Remote/cloud payloads do not expose local filesystem paths.
- Approval cards expose display path metadata, file names, size/hash-relevant metadata where available, safety labels, and privacy labels, not local approval binding paths.
- Duplicate terminal approval behavior remains enforced by the existing approval service and tests; this phase adds timeline persistence around those decisions.

Phase 3.4/4 files changed:

- `src/chat/ChatRepository.ts`
- `src/db/connection.ts`
- `src/db/migrate.ts`
- `src/db/schema.sql`
- `src/runtime/RemoteTaskDispatcher.ts`
- `src/server.ts`
- `tests/ChatPersistence.test.ts`
- `tests/Database.test.ts`
- `ui/src/App.tsx`
- `ui/src/api/*`
- `ui/src/components/*`
- `ui/src/hooks/queries.ts`
- `ui/src/main.tsx`
- `ui/src/realtime/RealtimeTransport.ts`
- `ui/src/styles.css`
- Generated by build: `public/index.html` and current `public/assets/*`

Phase 3.4/4 focused verification:

- `npm.cmd run typecheck` - passed.
- `npm.cmd run build` - passed. Vite generated the current `public/` assets.
- `npm.cmd test -- tests/ChatPersistence.test.ts tests/Database.test.ts` - initially failed because the approval-card timeline payload omitted a privacy label when the local index returned zero candidates.
- Root cause: privacy messaging was attached only to candidate rows instead of the approval card itself.
- Fix: added approval-card-level privacy labels in `messageToTimeline()`.
- `npm.cmd test -- tests/ChatPersistence.test.ts tests/Database.test.ts` - passed after the fix with 5 tests passing.

Phase 3.4/4 full-suite verification:

- `npm.cmd test` - initially failed once with `SqliteError: database is locked` while parallel Vitest workers initialized test databases.
- Root cause: the new chat-table migration increased concurrent SQLite DDL work during test startup, and the local connection had no busy timeout.
- Fix: added `PRAGMA busy_timeout = 5000` in `src/db/connection.ts`.
- `npm.cmd test -- tests/AgentRun.test.ts` - passed after the busy-timeout fix.
- `npm.cmd test` - passed after the fix: 37 test files passed, 1 skipped; 264 tests passed, 1 skipped.

Final current-tree verification:

- `npm.cmd run typecheck` - passed.
- `npm.cmd run build` - passed. Current generated assets are `public/assets/index-BRglzbfL.css` and `public/assets/index-2KC8JlwB.js`.
- `npm.cmd test` - passed: 37 test files passed, 1 skipped; 264 tests passed, 1 skipped.
- `npm.cmd --prefix apps/control-plane run typecheck` - passed.
- `npm.cmd --prefix apps/control-plane test` - passed: 3 test files passed; 25 tests passed.
- `npm.cmd --prefix apps/control-plane run build` - passed.
- `npm.cmd --prefix apps/admin-portal run typecheck` - passed.
- `npm.cmd --prefix apps/admin-portal test` - passed: 1 test file passed; 7 tests passed.
- `npm.cmd --prefix apps/admin-portal run build` - passed.

Remaining known limitations after this phase:

- The complete two-laptop relay transfer path still needs a dedicated end-to-end implementation pass for transfer availability, receiver download, SHA-256 verification receipt, and admin-visible transfer lifecycle across two live agents.
- The current implementation persists and displays the local/relay chat workflow, inbound remote file-request approval timeline, and approval decision timeline, but it does not yet prove the full cross-device transfer receipt sequence end to end.
- Browser-level visual verification remains blocked by the local browser automation environment noted above.

## Phase 5/6/7 Protocol And Retrieval Update

Implemented the requested A2A v1, ANP hardening, sqlite-vec migration, and hybrid retrieval fixes.

A2A v1 changes:

- `POST /v1/tasks/:id:subscribe` is supported through the public Fastify rewrite path and covered by tests.
- A2A v1 push notification config responses now emit `taskPushNotificationConfig`.
- Legacy `pushNotificationConfig` input remains accepted for backward compatibility.
- Agent Card signing now signs canonical JSON of the unsigned card with `signatures` excluded.
- Agent Card JOSE protected/header `typ` is now `JOSE`.
- Extended Agent Card requires Authorization.
- Remote/cloud A2A route protection is available through route auth options and tests cover no-token and cross-org rejection.
- A2A v1 payload tests verify no runtime `kind` field is emitted.

ANP changes:

- Handshake offers now sign the full snake_case canonical payload:
  `protocol`, `offer_id`, `from_agent_id`, `from_agent_instance_id`, `from_did`, `to_peer`, `nonce`, `created_at`, `expires_at`.
- Canonicalization now uses deterministic canonical JSON rather than nonce-only or length-prefixed field signing.
- Timing validation uses `created_at` and `expires_at`.
- Peer sessions now persist `peer_agent_instance_id`, with a migration backfill for existing sessions.
- `docs/anp-hardening.md` was rewritten to state implemented scope and remaining non-implemented ANP network capabilities honestly.

sqlite-vec/retrieval changes:

- Old vec0 table migration now stages rowid and embedding rows, recreates partition-key vec0 tables, reinserts compatible rows, and drops staging tables.
- `HybridRetrievalPipeline` now computes enough MMR-selected candidates for `offset + limit` and returns `slice(offset, offset + limit)`.
- Added regression tests for compatible vec0 embedding preservation, staging-table cleanup, and stable non-overlapping retrieval pagination.

Phase 5/6/7 failures encountered:

- Focused test run initially failed in `tests/FileIndexerReindex.test.ts` while seeding a legacy vec0 row: sqlite-vec required an integer primary key rowid. The test used a JS number; changing it to `42n` fixed the seed.
- `npm.cmd run typecheck` initially failed because the A2A route auth verifier referenced `cloudIdentityStore`; the actual local variable is `cloudStore`. The verifier was corrected.

Phase 5/6/7 verification:

- `npm.cmd run typecheck` - passed.
- `npm.cmd test -- tests/A2Av1.test.ts tests/AnpHardening.test.ts tests/HybridRetrieval.test.ts tests/FileIndexerReindex.test.ts` - passed: 4 test files, 74 tests.
- `npm.cmd test` - passed: 37 test files passed, 1 skipped; 271 tests passed, 1 skipped.
- `npm.cmd run build` - passed. Current generated assets remain `public/assets/index-BRglzbfL.css` and `public/assets/index-2KC8JlwB.js`.

Remaining known limitations after Phase 5/6/7:

- Remote A2A auth is implemented as a deterministic route verifier hook and wired to local device token checks when `AGENTIC_A2A_REMOTE_AUTH_REQUIRED=true`; production relay/device-token semantics still need end-to-end control-plane integration tests.
- ANP remains a local DID/keypair plus hardened handshake adapter, not full decentralized ANP network compliance.

## Files Changed

- `apps/control-plane/package.json`
- `apps/control-plane/scripts/run-vitest.mjs`
- `apps/control-plane/vitest.config.mjs`
- `apps/control-plane/src/auth/AuthMiddleware.ts`
- `apps/control-plane/src/enrollment/EnrollmentService.ts`
- `apps/control-plane/tests/control-plane.test.ts`
- `package.json`
- `src/cloud/DirectoryClient.ts`
- `src/cloud/LocalCloudIdentityStore.ts`
- `src/cloud/RelayClient.ts`
- `src/db/migrate.ts`
- `src/db/schema.sql`
- `src/enrollment/AgentRegistrationService.ts`
- `src/enrollment/DeviceEnrollmentService.ts`
- `src/runtime/HeartbeatService.ts`
- `src/runtime/InboxPoller.ts`
- `src/runtime/RemoteTaskDispatcher.ts`
- `src/server.ts`
- `tests/LocalCloudFacade.test.ts`
- `docs/api-contract.md`
- `docs/research-update.md`
- `docs/debug-report.md`

Build output also regenerated the current `public/` asset files. Git reports the previously tracked hashed asset files as deleted:

- `public/assets/index-BcwbyRov.css`
- `public/assets/index-DBtkvvLX.js`

The current generated files on disk are:

- `public/assets/index-DklYHqEg.css`
- `public/assets/index-CiIfF4s8.js`

## Remaining Known Limitations

- `npm install` reports 1 critical severity vulnerability. This was not changed because dependency upgrades or `npm audit fix` may alter the dependency graph and require a separate review.
- `npm install` reports pending `allow-scripts` warnings for native/package scripts. These were not changed in this pass.
- The root test suite still skips legacy `tests/TwoLaptopE2E.test.ts`; relay-first acceptance coverage is now handled by `npm run test:e2e:relay`.
- `git status` reports a permission warning for `C:\Users\Skanda Ganesha L/.config/git/ignore`; this is outside the repo and was not changed.
- This earlier pass did not complete all product hardening; later phases added the relay-first E2E script, retrieval pagination/migration fixes, A2A/ANP hardening, and chat UI contracts.
- Remote relay file requests now create local approval workflow entries, and approval triggers local-runtime cloud transfer upload, receiver download, SHA-256 verification, local storage, and receipt.

## Phase 8-13 Update

Date: 2026-06-08

### Commands Run

- `npm.cmd run typecheck` - passed after fixes.
- `npm.cmd test -- tests/NotificationCallbackIdempotency.test.ts tests/ApprovalHashing.test.ts tests/Database.test.ts` - passed: 14 tests.
- `npm.cmd --prefix apps/control-plane test` - initially failed once in the new admin hardening test because the expected denial status was `403`, while device token revocation correctly returned `401 DEVICE_TOKEN_REVOKED`; passed after test correction: 4 files, 29 tests.
- `npm.cmd --prefix apps/admin-portal run typecheck` - passed.
- `npm.cmd --prefix apps/admin-portal run build` - passed.
- `npm.cmd run test:e2e:relay` - passed and printed `PASS two-agent relay file request`.
- `npm.cmd test -- tests/ChatFrontendWorkflow.test.ts` - initially failed because the test required missing exported frontend message type names and looked for a relay endpoint in the wrong module; passed after adding type exports and fixing the test.
- `npm.cmd run typecheck` after frontend type changes initially failed because the new `A2ATaskMessage` union member lacked a render branch; passed after adding the branch.

### Bugs Found And Fixed

- Approval callbacks were only status-idempotent, not DB-idempotent. Added `approval_idempotency_keys`, terminal transition enforcement, duplicate approve/reject replay behavior, and tests.
- Duplicate approve could schedule duplicate transfer promotion work. Approval transfer creation now checks terminal approval state and existing `(task_id, sha256)` transfer before promotion.
- Production admin setup was unguarded when no admin existed. Added `ADMIN_SETUP_ENABLED`; production setup now fails unless explicitly enabled.
- Admin portal lacked revocation operations. Added user disable, device revoke, agent-instance disable APIs, UI actions, and tests.
- Admin portal lacked approvals/security pages. Added Approvals and Security / Revocation pages.
- Relay-first E2E script did not exist. Added `scripts/e2e-two-agent-relay-test.ts` and `npm run test:e2e:relay`.
- Frontend shared message names were not explicitly exported. Added `HumanChatMessage`, `AgentStatusMessage`, `SystemEventMessage`, `FileRequestMessage`, `TransferProgressMessage`, `FileReceiptMessage`, and `A2ATaskMessage`.
- The chat renderer did not handle the new A2A task union member. Added an A2A task card branch.
- Failed optimistic messages now show an explicit `Retry` affordance.

### Files Changed In This Phase

- `apps/control-plane/src/admin/AdminAuthService.ts`
- `apps/control-plane/src/admin/AdminRoutes.ts`
- `apps/control-plane/src/config.ts`
- `apps/control-plane/tests/admin-hardening.test.ts`
- `docs/admin-monitoring.md`
- `docs/frontend-chat-architecture.md`
- `docs/security-model.md`
- `docs/two-laptop-deployment.md`
- `package.json`
- `README.md`
- `scripts/e2e-two-agent-relay-test.ts`
- `src/db/migrate.ts`
- `src/db/schema.sql`
- `src/protocol/PersonalAgentProtocol.ts`
- `src/server.ts`
- `tests/ChatFrontendWorkflow.test.ts`
- `tests/NotificationCallbackIdempotency.test.ts`
- `ui-admin/src/portal/api/queries.ts`
- `ui-admin/src/portal/api/types.ts`
- `ui-admin/src/portal/layout/AdminRouter.tsx`
- `ui-admin/src/portal/layout/Sidebar.tsx`
- `ui-admin/src/portal/pages/AgentInstancesPage.tsx`
- `ui-admin/src/portal/pages/ApprovalsPage.tsx`
- `ui-admin/src/portal/pages/DevicesPage.tsx`
- `ui-admin/src/portal/pages/SecurityPage.tsx`
- `ui-admin/src/portal/pages/UsersPage.tsx`
- `ui/src/App.tsx`
- `ui/src/types.ts`

### Verification

The relay-first harness verifies signup, enrollment, heartbeat, admin presence, directory search, relay file request, Bob approval creation, approval-triggered cloud transfer upload, Alice download/storage, SHA-256 match, transfer receipt, and admin task/transfer/audit visibility.

### Remaining Known Limitations

- Bob approval now automatically initiates the cloud file-transfer upload to Alice; the relay E2E no longer drives upload/download/receipt manually.
- Frontend E2E coverage currently uses Vitest source/build workflow tests, not browser Playwright automation.
- The legacy skipped `tests/TwoLaptopE2E.test.ts` remains separate from the relay-first harness and still includes direct-agent compatibility coverage.

## Timeout Stabilization And A2A/ANP Cross-Check Update

Date: 2026-06-08

### Commands Run

- `npm.cmd test -- tests/AgentRun.test.ts tests/FileSearch.test.ts tests/NotificationCallbackIdempotency.test.ts` - passed: 3 files, 27 tests.
- `npm.cmd test -- tests/A2Av1.test.ts tests/AnpHardening.test.ts tests/AnpFullCompliance.test.ts` - passed: 3 files, 82 tests.
- `npm.cmd test -- tests/ChatFrontendWorkflow.test.ts` - passed: 1 file, 5 tests.
- `npm.cmd run test:e2e:frontend:vitest` - passed when run from the real workspace; sandboxed npm-run invocation can hit the known Windows/esbuild upward-read permission issue.
- `npm.cmd run typecheck` - passed.
- `npm.cmd install --save-dev @playwright/test` - added local Playwright test dependency; npm reported 1 critical audit finding and pending allow-scripts warnings.
- `npx.cmd playwright install chromium` - installed the Chromium browser binary required by Playwright.
- `npm.cmd run test:e2e:frontend:playwright` - passed: 3 browser tests.

### Exact Failures

- The 4 timeout failures listed in the implementation plan did not reproduce in this run. The slowest targeted test file still exercised file-search and notification-callback startup behavior, so targeted timeouts were added to prevent false negatives on slower Windows runs.
- The first frontend Vitest npm alias failed inside the sandbox mirror with `Cannot read directory "../..": Access is denied` and `Could not resolve ... vitest.config.ts`. Running the same test through the approved real-workspace npm test command passed.
- The first Playwright run failed because `@playwright/test` was not installed locally.
- The second Playwright run failed because the Chromium browser binary had not been installed.
- The third Playwright run failed because the test asserted the enrolled shell before authentication; the app correctly rendered the auth screen first.
- The fourth Playwright run failed because text appeared in both the sidebar and chat timeline, triggering Playwright strict-mode ambiguity.

### Root Cause

- Timeout failures were environmental fragility, not logic failures, based on the targeted rerun.
- The Vitest alias issue is the same Windows/esbuild upward-read permission behavior already observed for direct Vitest invocations through the sandbox mirror.
- Playwright needed local project dependency resolution and a downloaded browser binary.
- Browser E2E needed to model the app's real state machine: auth screen first, enrolled chat shell after authenticated/enrolled status.

### Files Changed

- `docs/a2a-v1-compatibility.md`
- `docs/debug-report.md`
- `package.json`
- `package-lock.json`
- `playwright.config.mjs`
- `tests/AgentRun.test.ts`
- `tests/FileSearch.test.ts`
- `tests/NotificationCallbackIdempotency.test.ts`
- `tests/e2e/chat-frontend.spec.js`

### How The Fix Was Verified

- Targeted timeout-prone tests pass with per-file `30_000ms` Vitest timeout configuration.
- A2A v1 and ANP hardening targeted suites pass with 82 tests.
- Frontend Vitest workflow contract passes with 5 tests.
- Playwright browser E2E now covers auth-screen accessibility, enrolled-shell accessibility, and file-request detection/send behavior; all 3 tests pass.

### Remaining Known Limitations

- `npm install` still reports 1 critical dependency audit finding; it was not force-fixed because that can introduce unrelated breaking changes.
- Playwright requires a one-time browser install with `npx playwright install chromium` on a fresh machine.
- The frontend Playwright suite is currently smoke/integration coverage. Deeper browser flows for real signup, enrollment against a live control plane, approval cards, and transfer receipt should be added after the relay/control-plane fixture is made deterministic for browser tests.

## Final Verification Update

Date: 2026-06-08

### Commands Run

- `npm.cmd test` - passed: 38 files, 281 tests; 1 legacy two-laptop test skipped.
- `npm.cmd run build` - passed.
- `npm.cmd run test:e2e:frontend:playwright` - passed: 3 browser tests.
- `npm.cmd run test:e2e:relay` - failed once with `EADDRINUSE` on `127.0.0.1:3399`; rerun passed and printed `PASS two-agent relay file request`.
- `npm.cmd --prefix apps/control-plane run typecheck` - passed.
- `npm.cmd --prefix apps/control-plane test` - passed: 4 files, 29 tests.
- `npm.cmd --prefix apps/control-plane run build` - passed.
- `npm.cmd --prefix apps/admin-portal run typecheck` - passed.
- `npm.cmd --prefix apps/admin-portal test` - passed: 1 file, 7 tests.
- `npm.cmd --prefix apps/admin-portal run build` - passed.

### Remaining Known Limitations

- Relay E2E originally used fixed local ports `3399` and `3400`; this was later fixed in the two-device readiness hardening update by allocating free loopback ports.
- Playwright browser binaries are installed outside the repo under the user Playwright cache and are not committed.

## Two-Device Readiness Hardening Update

Date: 2026-06-08

### Scope

This pass implemented the requested verification-driven hardening plan without rewriting the relay-first stack. The concrete fixes address command determinism and port contention found during the evidence pass:

- Root `npm test` originally failed because the loopback A2A harness used fixed ports `3399` and `3400`, and `3399` was already held by a running local agent.
- Admin portal tests originally failed before test collection because Vitest/Vite/esbuild attempted an upward directory read while resolving `apps/admin-portal/vitest.config.ts` under the managed Windows workspace.
- Relay E2E already reached the acceptance marker, but printed a late Alice `EADDRINUSE` on `127.0.0.1:3399`; the harness now allocates free loopback ports.

### Changes Made

- `src/loopback/LoopbackTestHarness.ts`: default loopback test ports now come from free `127.0.0.1` ports unless explicit `portA`/`portB` options are provided.
- `apps/admin-portal/package.json`: admin portal `test` now runs a package-local Node wrapper.
- `apps/admin-portal/scripts/run-vitest.mjs`: added the same deterministic Vitest runner pattern already used by the control-plane package, including `--configLoader runner`.
- `apps/admin-portal/vitest.config.mjs`: replaced the TypeScript config used by the package script with a package-rooted ESM config.
- `scripts/e2e-two-agent-relay-test.ts`: Alice and Bob now run on dynamically allocated free loopback ports.

### Required Command Checklist

- `npm.cmd install` - passed; npm reported packages up to date, 1 critical audit finding, and pending `allow-scripts` warnings for native/build packages.
- `npm.cmd run typecheck` - passed.
- `npm.cmd test` - passed after dynamic loopback ports: 38 test files passed, 1 skipped; 283 tests passed, 1 skipped.
- `npm.cmd run build` - passed; Vite generated `public/index.html`, `public/assets/index-DWbbZpl7.css`, and `public/assets/index-Dk173ouv.js`.
- `npm.cmd run test:control-plane` - passed: 4 files, 29 tests.
- `npm.cmd run build:control-plane` - passed.
- `npm.cmd run test:admin-portal` - failed before the admin runner fix with `Cannot read directory "../../../..": Access is denied`; passed after the wrapper fix: 1 file, 7 tests.
- `npm.cmd run build:admin-portal` - passed.
- `npm.cmd run test:e2e:relay` - passed and printed `PASS two-agent relay file request`.
- `npm.cmd --prefix apps/control-plane run typecheck` - passed.
- `npm.cmd --prefix apps/control-plane test` - passed: 4 files, 29 tests.
- `npm.cmd --prefix apps/control-plane run build` - passed.
- `npm.cmd --prefix apps/admin-portal run typecheck` - passed.
- `npm.cmd --prefix apps/admin-portal test` - passed after the wrapper fix: 1 file, 7 tests.
- `npm.cmd --prefix apps/admin-portal run build` - passed.

### Relay Acceptance Evidence

The relay-first harness now verifies the intended spine end to end:

`signup -> enroll -> heartbeat -> admin presence -> directory -> relay file request -> remote approval -> relay upload/download -> SHA-256 receipt -> admin task/transfer/audit visibility`

The final acceptance run printed:

```text
PASS two-agent relay file request
```

### Remaining Known Limitations

- `npm install` still reports 1 critical audit finding; this pass did not run `npm audit fix --force` because that can introduce unrelated dependency churn.
- Root tests still intentionally skip the legacy `tests/TwoLaptopE2E.test.ts`; relay-first readiness is covered by `npm run test:e2e:relay`.
- Node's experimental SQLite warning appears in some test output under Node 24; it is informational and did not fail verification.

## Two-Device Card Hardening Update

Date: 2026-06-08

### Scope

Implemented the remaining visible P0 hardening items without changing the relay-first architecture:

- A2A v1 subscribe route proof and compatibility documentation.
- JCS-style Agent Card canonicalization for signing, verification, and fingerprinting.
- Cloud-reachable control-plane Agent Cards that do not expose local agent URLs.
- Directory relay metadata for two-device discovery.
- Two-laptop docs cleanup for Node 24, dynamic relay E2E ports, and relay-first product behavior.

### Changes Made

- `src/protocol/a2a-v1/AgentCardV1.ts`: added strict canonical JSON behavior, top-level `signatures` exclusion, unsupported value rejection, and undefined cleanup in the card builder.
- `apps/control-plane/src/enrollment/CloudAgentCard.ts`: added cloud-card rewrite/sanitize helpers plus relay inbox and Agent Card URL builders.
- `apps/control-plane/src/enrollment/EnrollmentRoutes.ts`: `/v1/agents/:agent_instance_id/card` now returns the cloud-reachable card view and signs it when `AGENT_CARD_SIGNING_PRIVATE_KEY_PEM` is configured.
- `apps/control-plane/src/directory/DirectoryService.ts`: directory agent rows now include `relay_inbox_url`, `agent_card_url`, and `agent_card_hash`, while preserving existing UI compatibility fields.
- `src/cloud/DirectoryClient.ts` and `ui/src/types.ts`: updated types for the richer directory payload.
- `tests/A2Av1.test.ts` and `apps/control-plane/tests/control-plane.test.ts`: added regression coverage for canonicalization, subscribe route behavior, cloud card rewriting, signing verification, cross-org scoping, revoked-device denial, and directory metadata.
- `docs/two-laptop-deployment.md`, `docs/a2a-v1-compatibility.md`, `docs/api-contract.md`, and `docs/research-update.md`: updated to match the implemented relay-first contract.

### Verification

- `npm.cmd install` - passed; npm still reports 1 critical audit finding and allow-scripts warnings for `esbuild`/`ssh2` packages. No force fix was run.
- `npm.cmd run typecheck` - passed.
- `npm.cmd test -- tests/A2Av1.test.ts` - passed: 37 tests.
- `npm.cmd --prefix apps/control-plane test -- tests/control-plane.test.ts` - passed via package test wrapper: 4 files, 35 tests.
- `npm.cmd test` - passed: 38 files passed, 1 skipped; 287 tests passed, 1 skipped.
- `npm.cmd run build` - passed.
- `npm.cmd run test:control-plane` - passed: 4 files, 35 tests.
- `npm.cmd run build:control-plane` - passed.
- `npm.cmd run test:admin-portal` - passed: 1 file, 7 tests.
- `npm.cmd run build:admin-portal` - passed.
- `npm.cmd run test:e2e:relay` - passed and printed `PASS two-agent relay file request`.
- `npm.cmd --prefix apps/control-plane run typecheck` - passed.
- `npm.cmd --prefix apps/control-plane test` - passed: 4 files, 35 tests.
- `npm.cmd --prefix apps/control-plane run build` - passed.
- `npm.cmd --prefix apps/admin-portal run typecheck` - passed.
- `npm.cmd --prefix apps/admin-portal test` - passed: 1 file, 7 tests.
- `npm.cmd --prefix apps/admin-portal run build` - passed.

### Remaining Known Limitations

- Agent Cards are only re-signed by the control plane when `AGENT_CARD_SIGNING_PRIVATE_KEY_PEM` is configured. Without it, the rewritten cloud card is intentionally unsigned.
- `npm install` still reports the existing critical audit finding; dependency force-upgrade was out of scope for this pass.
- The legacy `tests/TwoLaptopE2E.test.ts` remains skipped; relay-first two-device readiness is covered by `npm run test:e2e:relay`.

## ANP, sqlite-vec, Retrieval, and Approval Hardening Update

Date: 2026-06-08

### Scope

Completed a narrow Phase 2-4 verification hardening pass:

- ANP signed payloads remain snake_case-only; camelCase aliases are compatibility fields and are not signed material.
- DID resolution now fails closed for malformed `did:key` values and malformed/unsupported `did:wba` shapes.
- sqlite-vec partition-key migration preserves compatible embeddings and leaves no `_staging` tables behind.
- Hybrid retrieval still paginates after MMR with `slice(offset, offset + limit)`.
- Approval callback idempotency and approval-to-transfer behavior are DB-backed and still produce exactly one transfer on approve.

### Changes Made

- `src/security/DidResolver.ts`: tightened `did:wba` parsing to accept only the supported `ed25519` bootstrap forms and reject malformed segment counts, empty fingerprints, invalid ports, and unsupported algorithms before network resolution.
- `tests/AnpHardening.test.ts`: added regression coverage for unsigned camelCase aliases, malformed `did:key` values, successful `did:wba` well-known resolution, and `did:wba` failure cases.
- `tests/FileIndexerReindex.test.ts`: strengthened the staging cleanup assertion to reject any remaining table whose name ends in `_staging`, not only `file_embeddings_staging`.
- `docs/anp-hardening.md`: clarified the supported DID-WBA bootstrap forms and the signed/unsigned compatibility-field boundary.

### Verification

- `npm.cmd test -- tests/AnpHardening.test.ts tests/FileIndexerReindex.test.ts tests/HybridRetrieval.test.ts tests/NotificationCallbackIdempotency.test.ts` - passed: 4 files, 55 tests.
- `npm.cmd run typecheck` - passed.
- `npm.cmd run test:e2e:relay` - passed and printed `PASS two-agent relay file request`.
- `npm.cmd test` - passed: 38 files passed, 1 skipped; 292 tests passed, 1 skipped.

### Remaining Known Limitations

- This remains an ANP-style hardened handshake adapter, not full decentralized ANP network compliance.
- DID-WBA support is intentionally limited to the local bootstrap resolver implemented in `src/security/DidResolver.ts`; full DID document processing and open-network ANP discovery remain out of scope.
