## Bug Fixes

- [x] Fix 1: Inject HybridVoiceCommandParser(getLlmProvider()) into VoiceCommandService in server.ts
- [x] Fix 2: Fix LlmVoiceCommandParser to accept VoiceCommandParserInput (not just string)
- [x] Fix 3: Add structured error logging to voice pipeline (console.warn/error on LLM failures)
- [x] Fix 4: Add ReceiverAgent orchestration — created ReceiverAgentOrchestrator.ts
- [x] Fix 5: Create receiver_approvals table in schema.sql
- [x] Fix 6: Add receiver approval API routes — created ReceiverApprovalRoutes.ts and registered in server.ts
- [x] Fix 7: Create VoiceCommandCard + ReceiverApprovalCard UI components
- [x] Fix 8: Wire voice_command and receiver_file_approval message types in MessageBubble.tsx
- [x] Fix 9: Run typecheck and fix any type errors (completed)

## Phase 2 — Receiver Agent Integration
- [x] Task 1: Add routing in RemoteTaskDispatcher to delegate file.request messages to ReceiverAgentOrchestrator
- [x] Task 2: Implement transferReceiverApproval in ApprovalTransferOrchestrator to perform actual upload/notification pipeline
- [x] Task 3: Hook up kickOffTransfer in ReceiverApprovalRoutes to trigger the real transfer upload
- [x] Task 4: Add comprehensive integration tests in voice-file-request-flow.test.ts verifying routing, db insert, approval API, and upload completion

## Notification Bridge Integration
- [x] Task 1: Assign fallback APPROVAL_CALLBACK_SECRET to process.env in server.ts (completed)
- [x] Task 2: Create toReceiverApprovalCandidatePayload in FileRequestCandidateResolver.ts (completed)
- [x] Task 3: Update ReceiverAgentOrchestrator to use local candidate payloads and send OS notifications via NotificationBridgeClient (completed)
- [x] Task 4: Update ApprovalCallbackSchema and /approvals/notification-callback in server.ts to route receiver approvals (completed)
- [x] Task 5: Add unit tests in voice-file-request-flow.test.ts to verify the Notification Bridge integration (completed)
- [x] Task 6: Run typecheck and tests to confirm full correctness (completed)

## Real-Time Messages and Session Persistence
- [x] Task 1: Load or generate a persistent `ui_session_secret` in `user_agent_settings` SQLite table on server startup in `src/server.ts`
- [x] Task 2: Mount `useRealtimePolling` hook inside `AppShell.tsx`
- [x] Task 3: Add `/events` and `/a2a` paths to Vite dev proxy config in `vite.config.ts`
- [x] Task 4: Verify the build and run typechecks + test suites
