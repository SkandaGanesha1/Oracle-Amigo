# Implementation Plan

[Overview]
Create a lightweight Tauri-based desktop voice launcher ("Amigo Voice Launcher") that registers a global shortcut (Ctrl+Space default, configurable), opens a compact always-on-top floating window (620x260-360px), captures microphone input via browser Web Audio API (POC path per user preference), transcribes with browser STT fallback to local agent, parses transcript into structured commands, sends to existing local agent /voice/commands endpoint, shows waveform/ transcript/preview/status, and integrates with the Oracle Amigo backend without duplicating any agent logic, directory, relay, A2A, approval, or storage code.

This adds a thin voice command surface on top of the existing distributed stack (local agent Fastify server on http://127.0.0.1:PORT, cloud directory, relay inbox polling, RemoteTaskDispatcher, ApprovalTransferOrchestrator, ChatRepository, PersonalAgentProtocol). It follows the exact architecture in the query (global shortcut → Tauri window → mic/waveform/STT → VoiceCommandParser → local agent API → full relay/A2A flow to remote agent). Browser STT for Phase 1 enables rapid validation of hotkey/window/command flow before adding whisper.cpp sidecar. Reuses existing React/Vite patterns from ui/, Zod schemas, Fastify route style from src/server.ts, and AGENTS.md conventions (ES modules, camelCase, focused Vitest tests, Conventional Commits). No new backend agent system; voice launcher is strictly an input surface. Window states follow the defined state machine (hidden → listening → transcribing → preview_required → executing → completed). Security rules enforced (mic only after shortcut, visible indicator, Esc cancel, no raw audio storage, confirmation for remote actions).

[Types]
Add TypeScript interfaces/enums for voice-specific payloads, state machine, and command parsing that integrate with existing Zod-validated Fastify schemas and ChatRepository types.

type VoiceLauncherState = 
  | "hidden" 
  | "opening" 
  | "requesting_mic_permission" 
  | "listening" 
  | "speech_detected" 
  | "transcribing" 
  | "transcript_ready" 
  | "parsing_command" 
  | "preview_required" 
  | "executing" 
  | "submitted" 
  | "waiting_remote_approval" 
  | "completed" 
  | "failed";

interface VoiceCommandParseResult {
  intent: "remote_file_request" | "find_file" | "show_approvals" | "open_chat" | "open_inbox";
  targetPersonQuery?: string;
  fileQuery?: string;
  originalTranscript: string;
  confidence: number; // 0.0-1.0, >0.85 auto-confirm
  requiresConfirmation: boolean;
  locale?: string;
}

interface VoiceCommandRequest {
  transcript: string;
  source: "voice-launcher";
  mode: "preview_then_execute" | "auto_execute";
  locale?: string;
  confidence?: number;
}

interface VoiceCommandPreview {
  commandId: string;
  intent: string;
  title: string;
  targetUser?: { displayName: string; email?: string };
  fileQuery?: string;
  dataMovementNote: string;
  action: string;
  requiresConfirmation: boolean;
}

interface VoiceLauncherConfig {
  shortcut: string; // "CommandOrControl+Space" | "CommandOrControl+Shift+Space" | "Alt+Space" | "Alt+A" | custom
  windowWidth: number; // 620
  windowHeightCollapsed: number; // 260
  windowHeightExpanded: number; // 360
  alwaysOnTop: boolean;
  transparent: boolean;
  skipTaskbar: boolean;
  sttProvider: "browser" | "whisper-sidecar"; // default "browser" per user
}

Use Zod for all API boundaries (extend existing schemas in src/server.ts). Add VoiceCommandStatus enum matching DB states (captured, transcribed, parsed, preview_required, confirmed, submitted, running, completed, failed, cancelled).

[Files]
Modify root config files, create new Tauri app directory with React frontend + Rust backend, add voice module to existing local agent, create documentation and tests. No files deleted.

New files (full paths and purpose):
- apps/voice-launcher/package.json (Tauri v2 + Vite/React/TS deps, scripts for dev/tauri)
- apps/voice-launcher/vite.config.ts (React plugin, base config matching ui/)
- apps/voice-launcher/index.html (entry for Tauri WebView)
- apps/voice-launcher/src/main.tsx (React root with state machine provider)
- apps/voice-launcher/src/App.tsx (root layout with keyboard handlers)
- apps/voice-launcher/src/components/VoiceLauncherWindow.tsx (main frameless/overlay window with state-driven UI)
- apps/voice-launcher/src/components/WaveformOrb.tsx (animated canvas/WebGL waveform using AnalyserNode amplitude)
- apps/voice-launcher/src/components/TranscriptView.tsx (shows "You said: ..." text)
- apps/voice-launcher/src/components/CommandPreviewCard.tsx (renders preview with Send/Edit/Cancel per safety rules)
- apps/voice-launcher/src/components/VoiceStatusBar.tsx (mic indicator, Esc hint, progress)
- apps/voice-launcher/src/components/ErrorState.tsx (mic permission, agent offline, low confidence)
- apps/voice-launcher/src/hooks/useMicCapture.ts (getUserMedia + MediaRecorder/WebAudio for POC browser STT)
- apps/voice-launcher/src/hooks/useVoiceActivity.ts (VAD/silence detection)
- apps/voice-launcher/src/hooks/useShortcutState.ts (Tauri global-shortcut registration + configurable shortcuts)
- apps/voice-launcher/src/hooks/useTranscript.ts (STT result handling)
- apps/voice-launcher/src/hooks/useCommandExecution.ts (POST to /voice/commands, confirm flow)
- apps/voice-launcher/src/api/localAgentVoiceClient.ts (typed fetch wrapper for voice endpoints + fallback to typed input)
- apps/voice-launcher/src/styles/voice-launcher.css (acrylic blur, orb animation, status colors)
- apps/voice-launcher/src-tauri/Cargo.toml (tauri-plugin-global-shortcut, shell for sidecar)
- apps/voice-launcher/src-tauri/tauri.conf.json (window config: 620x300, alwaysOnTop, transparent, label "voice-launcher")
- apps/voice-launcher/src-tauri/capabilities/default.json (only global-shortcut:allow-register + http permissions to localhost agent port)
- apps/voice-launcher/src-tauri/src/lib.rs (Rust side for window show/hide, shortcut invoke)
- apps/voice-launcher/src-tauri/src/main.rs (Tauri builder)
- apps/voice-launcher/src-tauri/src/shortcuts.rs (register/unregister configurable shortcuts)
- apps/voice-launcher/src-tauri/src/window.rs (createVoiceWindow with dimensions, center on active monitor)
- src/voice/VoiceCommandTypes.ts (all new TS types above + Zod schemas)
- src/voice/VoiceCommandParser.ts (deterministic regex+keyword parser for first 7 supported commands, no LLM)
- src/voice/VoiceCommandService.ts (business logic: parse → directory resolve → preview creation)
- src/voice/VoiceCommandRoutes.ts (Fastify POST /voice/commands, GET /voice/commands/:id, POST /voice/commands/:id/confirm etc.)
- docs/voice-launcher-architecture.md (full diagram + phases + security model)
- docs/voice-command-parser.md (exact supported phrases, regex rules, confidence scoring)
- docs/voice-privacy-model.md (no always-listen, visible mic, no raw audio, confirmation rules)
- docs/voice-launcher-windows-setup.md (Tauri install, mic permission, shortcut conflicts)

Existing files modified (specific changes):
- package.json (add dev:voice-launcher, tauri:voice-dev, build:voice-launcher scripts; add tauri CLI to devDeps)
- src/server.ts (add voice_commands DB table migration in getDb init, register VoiceCommandRoutes, add /voice/status, integrate with existing ChatRepository/RemoteTaskDispatcher/ApprovalTransferOrchestrator for remote_file_request)
- src/db/connection.ts (add voice_commands table schema with all fields listed in query)
- tests/voice-command-parser.test.ts (new test file for 7 example utterances)
- tests/voice-command-service.test.ts (new)
- tests/voice-file-request-flow.test.ts (E2E with two-agent simulation)
- AGENTS.md (update with voice-launcher section for build commands and testing)

Configuration updates: tauri.conf.json for permissions/window, root .env.example for ORACLE_AMIGO_LOCAL_AGENT_URL.

[Functions]
Add 12 new functions across voice module and Tauri Rust/TS layers; modify 6 existing functions in server and runtime to expose voice API without changing core relay/A2A logic.

New functions:
- registerGlobalShortcut(shortcut: string, callback: () => void): Promise<void> in apps/voice-launcher/src-tauri/src/shortcuts.rs and TS hook (purpose: configurable Ctrl+Space etc. with Tauri plugin)
- createVoiceWindow(): Window in apps/voice-launcher/src-tauri/src/window.rs (purpose: create 620x360 transparent always-on-top window centered on active monitor)
- useMicCapture(): { start, stop, waveformData } hook in apps/voice-launcher/src/hooks/useMicCapture.ts (uses navigator.mediaDevices.getUserMedia + AnalyserNode for POC browser STT)
- parseVoiceCommand(transcript: string): VoiceCommandParseResult in src/voice/VoiceCommandParser.ts (signature: (transcript: string, locale?: string) => VoiceCommandParseResult; deterministic regex for "Ask {person} to send me {file}", confidence scoring, returns requiresConfirmation)
- handleVoiceCommand(req: VoiceCommandRequest): Promise<VoiceCommandPreview> in src/voice/VoiceCommandService.ts (purpose: calls parser, DirectoryClient.resolve, creates preview or routes to existing relay send-file-request)
- postVoiceCommand(transcript: string): Promise<VoiceCommandPreview> in apps/voice-launcher/src/api/localAgentVoiceClient.ts (purpose: typed fetch to http://127.0.0.1:PORT/voice/commands)
- confirmVoiceCommand(commandId: string): Promise<{status: string, relay_task_id?: string}> in same client file
- renderWaveform(canvas: HTMLCanvasElement, amplitude: number[]): void in WaveformOrb.tsx (purpose: animated orb with idle/speaking/thinking states)
- getVoiceLauncherConfig(): VoiceLauncherConfig in apps/voice-launcher/src/hooks/useShortcutState.ts (loads from tauri store or defaults)

Modified functions:
- buildServer(...) in src/server.ts (exact name, current file src/server.ts; required changes: init voice DB table, register new VoiceCommandRoutes, add voice_commands migration, expose /voice/* endpoints that delegate to VoiceCommandService which reuses existing RemoteTaskDispatcher and ChatRepository)
- dispatch(message: RelayInboxMessage) in src/runtime/RemoteTaskDispatcher.ts (add support for voice-generated messages to append to chat timeline and create conversation if needed for "open_chat" intent)
- createApproval(...) in src/protocol/PersonalAgentProtocol.ts (ensure voice-sourced approvals respect requiresConfirmation from parser)
- parseBody(schema, body) helper (extend to support new VoiceCommandRequest schema)
- handleA2ARequest in protocol/a2a/A2AHandler.js (minor extension if voice needs to trigger A2A tasks)
- main React render in ui/src/main.tsx patterns (no change to full UI, but add link from voice launcher "Open in Oracle Amigo" that opens full chat with conversationId from voice response)

Removed functions: none. Migration strategy: existing typed-command path in launcher serves as fallback.

[Classes]
Add 3 new classes for parser, service, and React state machine; modify 2 existing classes for voice integration.

New classes:
- VoiceCommandParser (file path src/voice/VoiceCommandParser.ts, key methods: parse, normalizeTranscript, extractPersonAndFile using regex patterns for 7 commands listed, calculateConfidence; no inheritance, pure deterministic, Zod output validation)
- VoiceCommandService (file path src/voice/VoiceCommandService.ts, key methods: execute, createPreview, resolveTargetViaDirectoryClient, handleRemoteFileRequest using existing relay flow; depends on DirectoryClient, ChatRepository, PersonalAgentProtocol)
- VoiceLauncherStateMachine (file path apps/voice-launcher/src/hooks/useVoiceLauncherState.ts, key methods: transition, handleShortcut, handleTranscript, handleConfirm; uses React useReducer for the 14 defined states, integrates with Tauri invoke for window control)

Modified classes:
- RemoteTaskDispatcher (exact name, file path src/runtime/RemoteTaskDispatcher.ts; specific modifications: add handleVoiceCommand method that creates conversation, appends voice transcript as user message, triggers existing A2A file request flow for remote_file_request intent, returns relay_task_id for launcher status)
- Fastify server instance in src/server.ts (add voice route registration in buildServer function, inject VoiceCommandService)

No removed classes. All changes maintain sandbox/CommandPolicy boundaries.

[Dependencies]
Add Tauri v2 dependencies for the new voice-launcher app only; no changes to root agent dependencies. 

New packages: 
- @tauri-apps/cli (devDep in apps/voice-launcher/package.json, version ^2.0)
- @tauri-apps/api (^2.0)
- @tauri-apps/plugin-global-shortcut (^2.0)
- tauri-plugin (for Rust sidecar support if whisper added later)
- lucide-react (already in root, reuse for icons)
- framer-motion (already present, reuse for state transitions)
- Web Audio API is browser built-in (no new dep for POC STT).

Integration requirements: run `npm install` in apps/voice-launcher after creation; add Tauri setup commands to root package.json; whisper.cpp sidecar added only in Phase 7 via tauri sidecar config (optional, after browser POC). No version conflicts with existing zod/fastify/react.

[Testing]
Use Vitest for unit tests following AGENTS.md (FeatureName.test.ts naming, focused on parser/policy/sandbox); add E2E with existing two-laptop simulation scripts. 

Test file requirements: create tests/voice-command-parser.test.ts (7 exact utterances mapping to intents), tests/voice-launcher-window.test.ts (shortcut, states, keyboard), update tests/TwoLaptopE2E.test.ts and tests/LoopbackA2A.test.ts to include voice flow. Modify existing tests/AgentRegistry.test.ts if directory lookup changes. Validation strategies: mock getUserMedia for browser STT, test parser with "Ask Docin to send me NonPO invoice india.pdf file" → remote_file_request with target=Docin, fileQuery=NonPO invoice india.pdf; test 0-confidence requires confirmation; test Esc cancels mic; run full E2E with npm run test:e2e:relay and voice launcher pointing at Skanda agent (port 3399). Use existing demo-two-laptop.ps1 for verification. No raw audio in tests. Target 95% coverage on new voice/ module.

[Implementation Order]
Implement in strict phase order from the query (overlay+typed first, then mic, STT, parser, integration) to avoid blocking on complex audio and ensure incremental verification with existing E2E scripts.

1. Update root package.json with new scripts and add Tauri CLI.
2. Create entire apps/voice-launcher/ directory with Tauri config, React components, hooks for shortcut + typed command (Phase 1).
3. Implement Rust side for global shortcut registration and window management.
4. Add browser mic capture + WaveformOrb + basic state machine (Phase 2).
5. Add browser STT fallback and transcript display (Phase 3, per user preference).
6. Create src/voice/VoiceCommandParser.ts, Types.ts, Service.ts with deterministic parsing for all 7 commands and Zod schemas.
7. Add VoiceCommandRoutes.ts and DB table + endpoints to src/server.ts and db/connection.ts (Phase 4-5).
8. Wire command execution, preview, confirmation flow with existing RemoteTaskDispatcher, directory, relay, chat timeline (Phase 5).
9. Add full UI states, keyboard (Esc/Enter/Ctrl+Enter), error states, "Open in Oracle Amigo" link.
10. Add all tests, docs, privacy model, and Windows setup guide (Phase 9).
11. Update AGENTS.md, run full test suite + two-agent simulation with voice command "Ask Docin to send me NonPO invoice india.pdf file", verify file transfer.
12. Package with tauri build and test signed Windows installer (Phase 6).

Refer to @implementation_plan.md for a complete breakdown of the task requirements and steps. You should periodically read this file again using the PowerShell section commands below.

# Read Overview section
$content = Get-Content implementation_plan.md; $start = ($content | Select-String -Pattern '\[Overview\]').LineNumber; $end = ($content | Select-String -Pattern '\[Types\]').LineNumber; $content[($start-1)..($end-2)]

# Read Types section
$content = Get-Content implementation_plan.md; $start = ($content | Select-String -Pattern '\[Types\]').LineNumber; $end = ($content | Select-String -Pattern '\[Files\]').LineNumber; $content[($start-1)..($end-2)]

# Read Files section
$content = Get-Content implementation_plan.md; $start = ($content | Select-String -Pattern '\[Files\]').LineNumber; $end = ($content | Select-String -Pattern '\[Functions\]').LineNumber; $content[($start-1)..($end-2)]

# Read Functions section
$content = Get-Content implementation_plan.md; $start = ($content | Select-String -Pattern '\[Functions\]').LineNumber; $end = ($content | Select-String -Pattern '\[Classes\]').LineNumber; $content[($start-1)..($end-2)]

# Read Classes section
$content = Get-Content implementation_plan.md; $start = ($content | Select-String -Pattern '\[Classes\]').LineNumber; $end = ($content | Select-String -Pattern '\[Dependencies\]').LineNumber; $content[($start-1)..($end-2)]

# Read Dependencies section
$content = Get-Content implementation_plan.md; $start = ($content | Select-String -Pattern '\[Dependencies\]').LineNumber; $end = ($content | Select-String -Pattern '\[Testing\]').LineNumber; $content[($start-1)..($end-2)]

# Read Testing section
$content = Get-Content implementation_plan.md; $start = ($content | Select-String -Pattern '\[Testing\]').LineNumber; $end = ($content | Select-String -Pattern '\[Implementation Order\]').LineNumber; $content[($start-1)..($end-2)]

# Read Implementation Order section
$content = Get-Content implementation_plan.md; $start = ($content | Select-String -Pattern '\[Implementation Order\]').LineNumber; $content[($start-1)..($content.Length-1)]