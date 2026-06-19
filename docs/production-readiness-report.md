# Production Readiness Report

## Commit
727ba20f1e3a144d034003cacb606bb1248b9982

## Environment
Node version: v24.14.1

npm version: 11.16.0

OS: Microsoft Windows NT 10.0.26200.0

Date: 2026-06-18T00:01:03.8008320+05:30

Notes: the Windows CIM OS caption query was denied by local permissions, so OS was captured through .NET `System.Environment.OSVersion`. The repo had pre-existing dirty files before this verification pass; unrelated dirty work was not reverted.

## Commands Run
| Command | Result | Notes |
|---|---|---|
| `npm install` | Pass | Completed with `up to date in 27s`. npm warned that 5 packages have install scripts not covered by `allowScripts`: `@heroui/shared-utils@2.1.12`, `cpu-features@0.0.10`, `esbuild@0.28.0`, `ssh2@1.17.0`, `esbuild@0.27.7`. |
| `npm run typecheck` | Pass | Initial run passed. Final rerun after minimal harness fixes also passed: `tsc --noEmit && tsc -p tsconfig.ui.json --noEmit`. |
| `npm test` | Pass | Vitest root suite passed: 48 test files passed, 1 skipped; 389 tests passed, 1 skipped. Node emitted experimental SQLite warnings. |
| `npm run build` | Pass | Initial run passed. Final rerun after minimal harness fixes also passed. Vite built 4454 modules in 22.29s on final run. Warning remains for a large JS chunk: `assets/index-Bwl8UT56.js` is 1,673.92 kB minified, 471.81 kB gzip. |
| `npm run test:control-plane` | Pass | Control-plane tests passed: 4 test files, 42 tests. |
| `npm run build:control-plane` | Pass | TypeScript build passed. |
| `npm run test:admin-portal` | Pass | Admin portal adapter tests passed: 1 test file, 7 tests. |
| `npm run build:admin-portal` | Pass | TypeScript build passed. |
| `npm run test:e2e:relay` | Pass after minimal fixes | Initially failed on local API token, file-search root, and approval response-shape harness issues. After the minimal E2E harness fixes, rerun completed with `PASS two-agent relay file request`. |
| `npm run test:e2e:relay-message` | Pass after environment/script fix | The command hit a managed-sandbox Vitest/esbuild access failure before product tests ran. The package script was changed from nested `npm test -- ...` to direct `vitest run --config vitest.config.ts ...`; the requested command then passed outside the restricted sandbox with 2 test files and 30 tests. |
| `npm run test:e2e:relay-file-search` | Pass | Ran outside the restricted sandbox because the same Vitest/esbuild command shape had already failed there. Passed: 3 test files and 33 tests. |
| `npm run test:e2e:voice-file-request` | Pass | Ran outside the restricted sandbox for the same Vitest/esbuild reason. Passed: 1 test file and 3 tests, covering preview confirmation, receiver approval/transfer, and notification callback. |

## Failures Found
### `npm run test:e2e:relay`
- command: `npm run test:e2e:relay`
- exact error: `Error: alice GET /cloud/directory/users?q=bob failed: 401 {"error":"UNAUTHORIZED","message":"Local agent API token is required"}`
- root cause: the two-agent E2E harness predated local-agent API token hardening. Spawned local agents did not receive `LOCAL_AGENT_API_TOKEN`, and helper requests did not send `x-local-agent-token`.
- fix applied: added a deterministic E2E-only local API token to spawned agent environment and added `x-local-agent-token` to `agentGet` and `agentJson` helper requests in `scripts/e2e-two-agent-relay-test.ts`.
- verification result: rerun progressed beyond directory lookup.

### `npm run test:e2e:relay`
- command: `npm run test:e2e:relay`
- exact error: `Error: bob POST /files/index-roots failed: 400 {"error":"INVALID_INDEX_ROOT","message":"Index root is outside configured file-search roots"}`
- root cause: the harness created Bob's test document root outside the configured local file-search roots.
- fix applied: moved Bob's test docs under Bob's test storage root and set `SANDBOX_FILE_SEARCH_ROOTS` for spawned agents in `scripts/e2e-two-agent-relay-test.ts`.
- verification result: rerun progressed beyond file indexing.

### `npm run test:e2e:relay`
- command: `npm run test:e2e:relay`
- exact error: `Timed out waiting for Bob approval card appears; inbox={...,"lastDispatchedCount":0,"dispatchCounter":1}`
- root cause: the relay item was being dispatched and the approval existed, but the harness searched only the stale camelCase `requesterAgentId` field. The API response currently exposes the safe response field as snake_case `requester_agent_id`.
- fix applied: added a compatibility helper that accepts either `requesterAgentId` or `requester_agent_id`, and improved the wait timeout message with the latest inbox status.
- verification result: rerun completed successfully with `PASS two-agent relay file request`.

### `npm run test:e2e:relay-message`
- command: `npm run test:e2e:relay-message`
- exact error:
  ```text
  X [ERROR] Cannot read directory "../..": Access is denied.
  X [ERROR] Could not resolve "C:\\Users\\Skanda Ganesha L\\Desktop\\Oracle_Amigo\\vitest.config.ts"
  ```
- root cause: the managed command sandbox blocked Vitest/esbuild config resolution before product tests ran. The package script also used nested `npm test -- ...`, which made the command less direct for the sandbox.
- fix applied: changed targeted E2E scripts in `package.json` to call `vitest run --config vitest.config.ts ...` directly. No product code path was changed.
- verification result: the direct targeted tests passed, and the requested `npm run test:e2e:relay-message` command passed outside the restricted sandbox with 2 test files and 30 tests.

## Current Product Spine Status
- signup/login: Verified by control-plane tests and the two-agent relay E2E flow.
- device enrollment: Verified by the two-agent relay E2E flow and local cloud facade coverage.
- heartbeat: Verified by the two-agent relay E2E flow and control-plane/admin visibility tests.
- directory search: Verified by the two-agent relay E2E flow and control-plane tests.
- relay message: Verified by `npm run test:e2e:relay-message`.
- relay file request: Verified by `npm run test:e2e:relay` and `npm run test:e2e:relay-file-search`.
- approval: Verified by `npm run test:e2e:relay`, root tests, and `npm run test:e2e:voice-file-request`.
- transfer: Verified by `npm run test:e2e:relay` and `npm run test:e2e:voice-file-request`.
- SHA-256 verification: Verified by the two-agent relay E2E transfer flow and storage/file verification coverage in the root test suite.
- admin visibility: Verified by control-plane tests, admin-portal tests, and the two-agent relay E2E flow's admin visibility checks.
- Quick Voice file request: Verified by `npm run test:e2e:voice-file-request`.

## Production Blockers
- Windows installer, code signing, auto-start integration, auto-update, uninstall behavior, and packaged upgrade testing remain roadmap items. The docs identify the current baseline as source/developer-run rather than production-installed.
- Production control-plane startup now has an environment validation gate for HTTPS public URL, strong JWT/admin/transfer secrets, RS256 key material, static admin-token removal, `ADMIN_COOKIE_HOST_PREFIX=true`, and non-wildcard CORS. Operators still need the deployment runbook for TLS termination, secret rotation, `ADMIN_KEK` lifecycle, database backup/restore, log retention, and alerting.
- Podman Compose pilot assets now exist for the control plane and Admin Portal, including Caddy reverse proxy, env templates, Postgres volume, transfer-store volume, and `/health` `/livez` `/ready` endpoints. This is pilot deployment coverage only, not Kubernetes or enterprise HA readiness.
- Local-agent production startup now rejects disabled remote A2A auth and non-loopback binds unless explicitly overridden. Filesystem-backed local identity/token storage is warning-only for two-laptop testing and remains a production hardening risk until OS keychain or external secure storage is implemented.
- Supply-chain install-script review is incomplete. `npm install` warns that 5 package install scripts are not covered by `allowScripts`; these should be explicitly reviewed and pinned before release.
- The targeted Vitest E2E commands can fail inside the managed Codex sandbox with esbuild access-denied errors even when the tests pass in a normal execution context. CI should run these commands in a standard workspace and archive logs/artifacts.
- The production chat UI bundle is large enough to trigger Vite's chunk-size warning. This is not a functional failure, but it is a launch performance risk for low-power Windows devices.
- Full browser-based production smoke coverage is not part of the requested command set. Playwright coverage should verify login, enrollment, relay chat, approval, transfer verification, Quick Voice, focus order, status messages, and no text overlap.

## Recommended Next PRs
- Add the next production deployment/runbook PR for managed DB support, TLS certificate rotation, secret rotation, backup/restore drills, monitoring alerts, log retention, operational rollback, and Kubernetes or equivalent orchestration.
- Add an OS credential-store PR for local device identity and token storage so `LOCAL_AGENT_SECRET_STORAGE=filesystem` can become fail-fast in production.
- Complete the Windows installer PR: code signing, service/auto-start behavior, notification bridge packaging, uninstall cleanup, update channel, and signed build verification.
- Add CI jobs for the relay and voice E2E commands in a normal workspace, with local API token harness setup and uploaded logs for failures.
- Review and commit explicit `allowScripts` policy for the 5 packages reported by `npm install`.
- Add browser E2E and accessibility smoke tests for the critical product spine: signup/login, device enrollment, chat, approval, transfer, SHA-256 verification, admin visibility, and Quick Voice file request.
- Split the main Vite bundle with route-level dynamic imports and manual chunks for vendor-heavy surfaces.
