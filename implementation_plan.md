# Implementation Plan

[Overview]
Implement a complete voice-activated command surface (QuickVoice.exe via Tauri) that posts exclusively to the local TypeScript agent, which owns all parsing, validation, mission creation, A2A relay dispatch, audit logging, and UI timeline updates while maintaining strict security boundaries and human-in-the-loop approvals for all remote file requests.

The existing codebase already contains partial voice support (src/voice/, tests/voice-command-parser.test.ts, tests/voice-command-service.test.ts, tests/voice-file-request-flow.test.ts, docs/voice-command-api.md, docs/voice-launcher-architecture.md, docs/voice-privacy-model.md, voice related endpoints in vite.config.ts proxy rules and src/server.ts route registration patterns). This implementation expands it into the full deterministic 20-state workflow (VOICE_CAPTURED → ... → COMPLETED and all failure states), adds the independent voice_commands table, LLM+Zod structured parser (rule-based first then LLM fallback), Tauri desktop launcher with global Ctrl+Space hotkey + mic capture + waveform + preview states, new message types ("voice_command", "mission") in the React Agentic Chat UI, integration with existing runtime/RemoteTaskDispatcher.ts, policy/, registry/, and storage/ layers, and phased rollout starting with typed commands before adding Web Speech API then whisper.cpp sidecar. This fulfills the core architectural decision that QuickVoice is only the input surface, the local agent is the brain/workflow owner, Control Plane is the relay, and remote agents (e.g. Docin) are the executors, with every step auditable and requiring explicit confirmation. The plan avoids cross-language complexity by keeping core logic in TypeScript while using Tauri (Rust backend + React frontend) for the small always-on-top launcher window.

[Types]
Extend the existing voice command types with a strict Zod schema-first design for all LLM outputs, DB records, UI states, and workflow events to guarantee validation, auditability, and type safety across frontend, backend, and Tauri app.

```ts
export const VoiceCommandIntentSchema = z.enum([
  "remote_file_request", "local_file_search", "show_pending_approvals",
  "open_chat", "show_received_files", "unknown"
]);

export const VoiceCommandSchema = z.object({
  schema_version: z.literal("voice-command.v1"),
  intent: VoiceCommandIntentSchema,
  target_person_query: z.string().nullable(),
  file_query: z.string().nullable(),
  file_extensions: z.array(z.string()).default([]),
  requester_reference: z.literal("current_user"), // immutable per security rule
  confidence: z.number().min(0).max(1),
  requires_confirmation: z.boolean(),
  missing_fields: z.array(z.string()).default([]),
  original_transcript: z.string()
});

export type VoiceCommandStatus = 
  | "VOICE_CAPTURED" | "TRANSCRIPT_CREATED" | "COMMAND_PARSED" | "TARGET_RESOLVED"
  | "COMMAND_PREVIEW_CREATED" | "USER_CONFIRMED" | "A2A_FILE_REQUEST_CREATED"
  | "RELAY_SUBMITTED" | "RECEIVER_AGENT_DELIVERED" | "RECEIVER_SEARCHING_FILES"
  | "RECEIVER_APPROVAL_REQUIRED" | "RECEIVER_APPROVED" | "TRANSFER_STARTED"
  | "TRANSFER_UPLOADED" | "REQUESTER_DOWNLOADED" | "HASH_VERIFIED"
  | "STORED_IN_VAULT" | "RECEIPT_CREATED" | "COMPLETED"
  | "NO_TARGET_FOUND" | "AMBIGUOUS_TARGET" | "TARGET_AGENT_OFFLINE"
  | "UNSUPPORTED_COMMAND" | "LOW_CONFIDENCE_PARSE" | "RECEIVER_NO_FILE_FOUND"
  | "RECEIVER_REJECTED" | "TRANSFER_FAILED" | "HASH_MISMATCH" | "TIMEOUT";

export interface VoiceCommandRecord {
  id: string; // vcmd_01J...
  profile_id: string;
  org_id?: string;
  user_id: string; // always current enrolled user
  agent_id: string;
  agent_instance_id?: string;
  transcript: string;
  parsed_intent: VoiceCommandIntent;
  parsed_json: string; // JSON.stringify of validated schema
  status: VoiceCommandStatus;
  confidence?: number;
  conversation_id?: string;
  mission_id?: string;
  relay_task_id?: string;
  created_at: string;
  confirmed_at?: string;
  completed_at?: string;
  error_message?: string;
}

export type QuickVoiceUIState = 
  | "idle" | "listening" | "transcribing" | "parsing" | "preview_required"
  | "confirming" | "submitted" | "waiting_receiver" | "completed" | "failed";

export interface VoiceListeningState {
  command_id?: string;
  transcript: string;
  parsed?: z.infer<typeof VoiceCommandSchema>;
  preview?: { title: string; summary: string; safety: string[]; actions: string[] };
  audioLevel: number; // 0.0-1.0
  uiState: QuickVoiceUIState;
  waveformBars: Array<{height: number; delay: number}>;
}

export type MessageType = "human" | "agent" | "system" | "file_request" | "approval" | "transfer" | "receipt" | "voice_command" | "mission";
```

All types live in src/voice/VoiceCommandTypes.ts with Zod validation at every API boundary. Relationships: voice_commands references missions and conversations via foreign keys but remains an independent table per user confirmation.

[Files]
Create 18 new files (Tauri app + voice services + DB migration) and modify 11 existing files to integrate the full voice command pipeline while building on current voice-command-service.test.ts and voice-command-api.md.

- **New files to be created:**
  - apps/voice-launcher/package.json (Tauri + Vite + React setup with tauri deps)
  - apps/voice-launcher/vite.config.ts (proxy to local agent port 3399)
  - apps/voice-launcher/index.html
  - apps/voice-launcher/src/main.tsx (React root with global shortcut context)
  - apps/voice-launcher/src/App.tsx (state machine for all QuickVoiceUIState)
  - apps/voice-launcher/src/api/localAgentVoiceClient.ts (typed fetch wrapper for /voice/* endpoints)
  - apps/voice-launcher/src/components/VoiceLauncherWindow.tsx (always-on-top floating window)
  - apps/voice-launcher/src/components/WaveformOrb.tsx (12-bar yellow animated waveform using CSS @keyframes + audioLevel)
  - apps/voice-launcher/src/components/TranscriptView.tsx, CommandPreviewCard.tsx, CommandStatusCard.tsx, TargetDisambiguation.tsx, MicPermissionError.tsx
  - apps/voice-launcher/src/hooks/useGlobalShortcut.ts (Ctrl+Space with Tauri global-shortcut plugin), useMicCapture.ts, useWaveform.ts, useSpeechTranscription.ts, useVoiceCommand.ts
  - apps/voice-launcher/src-tauri/Cargo.toml, tauri.conf.json, capabilities/default.json (global-shortcut:allow-register permission), src/main.rs, lib.rs, shortcuts.rs, window.rs
  - src/voice/VoiceCommandTypes.ts (all Zod schemas + interfaces above)
  - src/voice/LlmVoiceCommandParser.ts (OpenAI/Anthropic structured output with repair prompt on Zod failure)
  - src/voice/RuleBasedVoiceCommandParser.ts (regex patterns for "Ask {person} to send me {file}", "Request {file} from {person}", etc.)
  - src/voice/VoiceCommandRepository.ts (CRUD for independent voice_commands table using existing DB patterns from src/db/)
  - src/voice/VoiceCommandRoutes.ts (Fastify routes for all 6 endpoints listed in spec)
  - src/voice/VoiceCommandPolicy.ts (extends existing policy/ for confirmation and safety rules)
  - src/db/migrations/20260615_add_voice_commands_table.sql (independent table with all columns from spec)
  - tests/VoiceCommandParser.test.ts, tests/VoiceCommandService.test.ts, tests/VoiceCommandRoutes.test.ts, tests/VoiceRemoteFileRequestE2E.test.ts (new focused Vitest tests)

- **Existing files to be modified:**
  - src/server.ts: register voice routes under /voice prefix, update existing voice service initialization
  - src/voice/voice-service.ts (or equivalent main voice service): add enterCenteredListeningMode, updateCenteredTranscript, integrate with new VoiceCommandService, emit mission creation events
  - src/runtime/RemoteTaskDispatcher.ts: extend to handle voice-triggered A2A file requests
  - src/runtime/ApprovalTransferOrchestrator.ts: wire RECEIVER_APPROVAL_REQUIRED → TRANSFER_STARTED flow
  - src/audit/AuditLogger.ts: add voice specific events for every state transition
  - ui/src/App.tsx: add support for new MessageType values, poll /voice/commands/:id and /chat/conversations/:id/messages, render mission cards for voice_command type
  - ui/src/components/ui/message.tsx: add 'voice_command' and 'mission' variants that render CommandPreviewCard or full mission timeline
  - ui/src/components/ui/chat-container.tsx: update to handle voice overlay state without breaking StickToBottom
  - docs/voice-command-api.md: expand with full request/response examples, security rules, and state machine diagram
  - docs/voice-launcher-architecture.md: document Tauri structure, shortcut registration, and phase 1-3 STT progression
  - package.json: add voice-launcher scripts (npm run dev:voice-launcher, npm run tauri:voice-dev, build targets)
  - tests/e2e/chat-frontend.spec.js: extend with voice command flow tests

- No files deleted. Update tsconfig.json alias if needed for @/voice imports; no dependency manifest changes beyond Tauri setup.

[Functions]
All new and modified functions follow existing camelCase/TypeScript patterns, use Zod validation at boundaries, and integrate with current CommandPolicy, AuditLogger, and Mission creation flows.

- **New functions:**
  - parseVoiceCommand(transcript: string, locale: string): Promise<z.infer<typeof VoiceCommandSchema>> - src/voice/LlmVoiceCommandParser.ts (tries RuleBasedVoiceCommandParser first, falls back to LLM with exact prompt from spec, retries once on parse failure, returns LOW_CONFIDENCE_PARSE on final failure)
  - createVoiceCommand(transcript: string, source: "quickvoice"): Promise<VoiceCommandRecord> - src/voice/VoiceCommandService.ts (validates, resolves target via DirectoryResolutionService, creates preview, stores in independent table, creates linked Mission)
  - registerGlobalShortcut() - apps/voice-launcher/src-tauri/src/shortcuts.rs (Tauri plugin with Ctrl+Space, permission in default.json)
  - startListening() / stopListening() / updateWaveform(audioLevel: number) - apps/voice-launcher/src/hooks/useVoiceCommand.ts (Web Audio API or mock, state machine for all QuickVoiceUIState)
  - renderVoiceMission(message: MessageWithVoiceData) - ui/src/components/ui/message.tsx (renders timeline card with status, "Open mission" button that links to mission_id)

- **Modified functions:**
  - handleVoiceCommand in src/server.ts / VoiceCommandRoutes.ts: add the 6 endpoints (GET /voice/status, POST /voice/commands, GET /voice/commands/:id, POST /voice/commands/:id/confirm, POST /voice/commands/:id/cancel, GET /voice/commands/:id/events) with exact request/response shapes from spec
  - processTranscript in existing voice-service.ts: replace with call to new parser + VoiceCommandService.createVoiceCommand, emit SSE or update for UI polling
  - renderMessage in ui/src/components/ui/message.tsx: add cases for "voice_command" and "mission" using new components instead of right-aligned bubbles
  - handleKeyDown in ui/src/components/ui/prompt-input.tsx (or equivalent): integrate with useGlobalShortcut hook, filter e.repeat, support Escape to cancel
  - createMission in src/workflow/ or runtime/: extend to accept voice_command_id and set type = "voice_file_request"

- **Removed functions:** Any legacy direct LLM execution paths (replaced by structured parser that never executes).

[Classes]
Extend existing service pattern (no new top-level classes, all are services per AGENTS.md coding style).

- **New classes/services:**
  - VoiceCommandService (src/voice/VoiceCommandService.ts): orchestrates parser → repository → mission → relay; key methods: createFromTranscript, confirm, getStatus, getEvents; implements the full 20-state machine with AuditLogger calls at each transition
  - LlmVoiceCommandParser (src/voice/LlmVoiceCommandParser.ts): uses existing LLM client with exact prompt from spec + Zod validation + repair loop; never decides requester identity
  - RuleBasedVoiceCommandParser (src/voice/RuleBasedVoiceCommandParser.ts): high-confidence regex fallback before LLM
  - VoiceCommandRepository (src/voice/VoiceCommandRepository.ts): SQLite/Postgres CRUD matching existing src/db/ patterns for the independent table
  - QuickVoiceClient (apps/voice-launcher/src/api/localAgentVoiceClient.ts): typed HTTP client with idempotency_key support

- **Modified classes:**
  - Existing VoiceService or main server instance in src/server.ts: gains VoiceCommandService instance and route registration
  - RemoteTaskDispatcher in src/runtime/RemoteTaskDispatcher.ts: adds handleVoiceFileRequest method that creates A2A payload from parsed command
  - AuditLogger in src/audit/AuditLogger.ts: adds logVoiceEvent(commandId, status, details) method

- **No classes removed.**

[Dependencies]
Add Tauri CLI and @tauri-apps/api, @tauri-apps/plugin-global-shortcut to the voice-launcher workspace; no changes to root package.json beyond new scripts; leverage existing zod, the LLM client (OpenAI/Anthropic), and Fastify patterns. For Phase 7 add whisper.cpp as a Tauri sidecar (via tauri-plugin-shell). No Python MAS until after TypeScript version is stable.

[Testing]
All changes must be covered by focused Vitest tests following existing naming (FeatureName.test.ts) and emphasis on policy, sandboxing, and E2E relay flows; update existing voice tests and add new ones.

- New test files: tests/VoiceCommandParser.test.ts (rule+LLM paths, repair prompt, LOW_CONFIDENCE_PARSE), tests/VoiceCommandService.test.ts (full state machine, independent table writes), tests/VoiceCommandRoutes.test.ts (exact API contracts), tests/VoiceRemoteFileRequestE2E.test.ts (full QuickVoice → local agent → relay → Docin simulation)
- Modify: tests/voice-command-service.test.ts, tests/voice-file-request-flow.test.ts, tests/e2e/chat-frontend.spec.js (add voice mission rendering and Ctrl+Space hold tests), tests/WorkflowStateMachine.test.ts
- Validation: 100% coverage of security rules (no direct LLM execution, always current_user as requester, confirmation before relay, receiver approval before transfer), visual snapshot tests for WaveformOrb and CommandPreviewCard, Playwright tests simulating full flow with typed command first then mic capture.

[Implementation Order]
Implement in strict phase order from the spec (Phase 0 verification first) to minimize conflicts with existing voice code, policy, and UI components.

1. Phase 0: Run `npm install`, `npm run typecheck`, `npm test`, `npm run build`, verify existing voice scripts (`npm run dev:voice-launcher` etc.) and update implementation_plan.md with this document.
2. Create independent voice_commands table migration and VoiceCommandRepository.ts + VoiceCommandTypes.ts.
3. Implement RuleBasedVoiceCommandParser.ts + LlmVoiceCommandParser.ts with exact Zod schema and prompt from spec.
4. Create VoiceCommandService.ts, VoiceCommandRoutes.ts, VoiceCommandPolicy.ts and register in src/server.ts (all 6 endpoints with exact shapes).
5. Update existing voice-service.ts, runtime/RemoteTaskDispatcher.ts, audit/AuditLogger.ts, and workflow to support the 20-state machine and mission creation from voice commands.
6. Create the full Tauri apps/voice-launcher/ structure with global shortcut, mic capture (Phase 1 typed command first), waveform, preview card, confirm/cancel, and polling for status.
7. Update UI (ui/src/App.tsx, message.tsx, chat-container.tsx) to support new MessageType values and render voice missions in timeline.
8. Add all new tests, run full test suite (`npm test`, `npm run test:e2e`), manual verification of Ctrl+Space, preview flow, and Docin file request example.
9. Phase 2-3: Add Web Speech API then WhisperSidecarTranscriber abstraction.
10. Phase 7-8: Add whisper.cpp sidecar, desktop packaging, and Python MAS option only after TypeScript baseline passes all tests and security review.