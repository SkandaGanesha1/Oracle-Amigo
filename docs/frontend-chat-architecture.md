# Frontend Chat Architecture

The product chat UI lives in `ui/` and builds into `public/`. It does not share code with `ui-admin/`.

## Stack

- React + TypeScript + Vite
- TanStack Query for server state
- TanStack Virtual for message-list virtualization
- Local reducer state for selected conversation, optimistic timeline entries, and offline outbox
- Lucide icons
- CSS in `ui/src/styles.css`

## Main Surfaces

- `AuthScreen`: signup/login with org slug, password, display name, and control-plane URL.
- `DeviceEnrollmentScreen`: device identity, agent name, capabilities, enroll action, heartbeat status.
- `MainChatLayout`: left people/conversation pane, center timeline/composer, right inspector.
- `DirectorySearch`: same-org user search and start-chat flow.
- `MessageComposer`: multiline send, Enter/Shift+Enter behavior, file-request preview, command suggestions.
- `ThinkingBar`: client-side grouped agent reasoning stream. `ChatWindow` collapses backend `agent_status` messages by run/task into one `thinking_bar` timeline item, so the main feed shows a continuous human-readable progress bar instead of separate technical debug bubbles.
- `ThreadDrawer` and `MessageActions`: Slack-like local message threads, reactions, copy, pin, and retry controls.
- `RightInspectorPanel`: split-view inspector with activity, agent, files, alerts, settings, and chat context tabs for trust/risk/data/audit review.
- `ApprovalCenter`: approve/reject/feedback and exact candidate metadata.
- Chat approval cards embed biometric approval plus redaction/watermark controls before a file transfer decision.
- `ReceivedFilesView`: received files, hash, received time, open/download and verify actions.
- `AuditTimeline`: local audit event filtering and IDs.
- `SettingsPanel`: control plane, enrollment, heartbeat, relay, notification, storage, and privacy toggles.

## API Layer

Typed frontend API modules:

- `ui/src/api/localAgentClient.ts`
- `ui/src/api/cloudAuthApi.ts`
- `ui/src/api/cloudDirectoryApi.ts`
- `ui/src/api/chatApi.ts`
- `ui/src/api/relayApi.ts`
- `ui/src/api/approvalsApi.ts`
- `ui/src/api/filesApi.ts`
- `ui/src/api/auditApi.ts`
- `ui/src/api/types.ts`

Hooks are in `ui/src/hooks/queries.ts` and include cloud status, current profile, directory, contacts, conversations, messages, send, file request, approvals, files, audit, diagnostics, and realtime polling.

## Realtime

`ui/src/realtime/RealtimeTransport.ts` defines:

- `RealtimeTransport`
- `PollingTransport`
- `SseTransport`
- `WebSocketTransport`

Polling is used today. WebSocket is intentionally not hardcoded.

## Message Types

The shared frontend message names are exported from `ui/src/types.ts`:

- `HumanChatMessage`
- `AgentStatusMessage`
- `ThinkingBarMessage`
- `SystemEventMessage`
- `FileRequestMessage`
- `FileCandidateApprovalCard`
- `TransferProgressMessage`
- `FileReceiptMessage`
- `A2ATaskMessage`

## Verification

Current workflow coverage uses Vitest source/build contract tests:

```bash
npm test -- tests/ChatFrontendWorkflow.test.ts
```

Browser-level Playwright tests are still recommended for production, but are not part of the stable local suite yet.

## Continuous Agent Reasoning

Raw tool status such as local search, command checks, and final-answer preparation must not render as independent chat bubbles. The active chat path derives a `ThinkingBarMessage` from related `AgentStatusMessage` rows, maps raw step text into short human summaries, and keeps the original technical trace behind an expandable disclosure with path, ID, and secret masking. This preserves transparency without making the primary timeline feel like a debug log.
