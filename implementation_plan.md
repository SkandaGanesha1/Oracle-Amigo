# Implementation Plan

Overhaul the chat UI from broken chain of thought (each agent step rendered as separate bubble with raw technical messages like "Choose tool: semantic_search", "Inspect semantic search results", "Confirm working directory", "Check exact file in configured local roots", "Prepare document preview", "Prepare final answer", "Found...") that pollutes the main timeline, no continuous streaming thinking bar, no threading for missions, no reactions, no suggested prompts, no split view/right context panel, no huddles, no biometric in approval cards within chat, no redaction/watermark in file request cards, leaking technical details and UUIDs, no universal command bar in composer, no trust badges or privacy indicators, to a true next-gen agentic chat with continuous ChainOfThought streaming thinking bar that aggregates reasoning in one collapsible/updating component, integrates all Phase 5 competitive features (5a-5g), adds Slack-like threading/reactions/suggested prompts/split view/huddles/trust transparency/bounded autonomy, WhatsApp-like biometric approval/mini-workflows/encryption indicators, best practices for message streaming/progressive disclosure/accessibility, while maintaining the existing TypeScript/React/TanStack/shadcn backend API spine, redesign foundations (MissionTimeline, ConsentConsole, VaultBrowser, HumanAuditLog, IntentInbox, privacy masking, realtime hooks), immutable audit hash chain, SecretPolicy/CommandPolicy boundaries, and AGENTS.md standards (Zod validation, focused *.test.ts, no secret leakage, Conventional Commits).

The new roast exposes that the current StreamLikeChat.tsx renders agent reasoning as disjointed bubbles, breaking the mental model of continuous thought and making the UI feel like a debug log instead of a seamless agentic conversation; this plan introduces a dedicated ThinkingBar component that streams the full chain of thought with collapsible steps inside one bar (addressing "why continuous messages are not being implemented in the chain of thoughts or thinking bar components"), uses MissionThreadPanel for isolated threaded discussion (5b) without polluting the main timeline, adds MessageReactions and SuggestedPrompts, implements ChatSplitView with right context panel for selected messages (showing trust graph, risk, data movement, audit preview, memory used), integrates BiometricApproveButton in approval cards (5c), RedactionEditor and WatermarkPreview in file cards (5d), universal Cmd+K command bar in the composer and top nav (5a), expanded OS-native notifications linked from chat (5e), AdminPolicyEngine enforcement in approvals (5f), mobile-first responsive layout with pull-to-refresh and native biometric (5g). It removes raw technical bubbles from the primary timeline (moved to expandable technicalTrace in the thinking bar), uses human-readable summaries for agent steps, adds progressive disclosure, trust badges on every agent message, privacy mode for sensitive content, streaming for agent responses, suggested prompts from LLM, reactions (like Slack), huddles for voice with agent summary, mini-workflows for common tasks, encryption indicators, and ensures accessibility (ARIA live regions for streaming, keyboard nav, contrast, touch targets). This fits the existing redesign by updating StreamLikeChat.tsx to conditionally render the ThinkingBar for agent messages instead of separate bubbles, extending MissionTimeline for threads, leveraging existing realtime hooks and workflow state machine, and adding minimal new services that respect sandbox boundaries and audit immutability. The result is a chat that feels like a smart, trustworthy, seamless competitor to Slack (streamed AI with threads/suggested prompts/trust), WhatsApp (biometric, mini-workflows, seamless mobile), and Teams (policy integration, customizable views), with the thinking bar providing continuous, transparent agent reasoning.

[Types]
Extend and add new TypeScript interfaces/enums in ui/src/types/agentic.ts (and ui/src/types.ts for UI-specific) with Zod validation schemas for all new structures, ensuring relationships to existing Mission, ConsentCard, VaultFile, Agent, AuditEvent (e.g. every ChatMessage references ThreadId for 5b, ThinkingStep[] for continuous chain of thought, Reaction[], SuggestedPrompt[], ContextPanelData, BiometricRequirement for 5c, RedactionConfig for 5d, PolicyRule for 5f).

interface ChainOfThoughtStep {
  id: string;
  description: string; // human e.g. "Your agent performed semantic search and found 1 exact match"
  technicalTrace: string; // raw "Choose tool: semantic_search..." for expandable
  status: 'pending' | 'completed' | 'failed';
  timestamp: Date;
  toolUsed?: string;
  confidence?: number;
}

interface ThinkingBarState {
  isActive: boolean;
  steps: ChainOfThoughtStep[];
  currentStepId?: string;
  summary: string; // human overall reasoning summary
  progress: number;
  streamingText?: string;
}

interface MessageReaction {
  emoji: string;
  count: number;
  users: string[];
}

interface SuggestedPrompt {
  text: string;
  category: 'approval' | 'mission' | 'search' | 'memory';
  confidence: number;
}

interface ChatSplitViewContext {
  messageId: string;
  trustGraph: AgentTrust[];
  riskScore: 'low' | 'medium' | 'high';
  dataMovement: { leavesDevice: boolean; recipient?: Agent; expiresAt?: Date; revocable: boolean };
  auditPreview: string[];
  memoryUsed: string[];
  actions: string[];
}

interface ThreadedMessage {
  id: string;
  parentMessageId: string;
  content: string;
  author: Agent;
  timestamp: Date;
  reactions: MessageReaction[];
  missionId?: string; // for 5b
}

enum ChatViewMode {
  MainTimeline,
  Threaded,
  ThinkingBarExpanded,
  PrivacyMasked
}

[Files]
Create 14 new files and modify 16 existing ones; update configuration files; no deletions; all changes follow AGENTS.md (2-space TS, Zod at boundaries, camelCase, focused tests).

New files:
- ui/src/components/chat/ThinkingBar.tsx (continuous chain of thought streaming bar with collapsible steps for agent reasoning)
- ui/src/components/chat/ChainOfThoughtStream.tsx (streaming renderer for thinking steps with progressive disclosure)
- ui/src/components/chat/MessageReactions.tsx (Slack-like reactions on messages)
- ui/src/components/chat/SuggestedPrompts.tsx (LLM-generated prompts below composer)
- ui/src/components/chat/ChatSplitView.tsx (right context panel for selected message with trust, risk, audit, memory)
- ui/src/features/mission/MissionThreadPanel.tsx (isolated threaded discussion for 5b, already in previous plan but integrated here)
- ui/src/components/consent/BiometricApproveButton.tsx (for 5c in approval cards within chat)
- ui/src/components/vault/RedactionEditor.tsx (for 5d in file request cards)
- ui/src/components/vault/WatermarkPreview.tsx (dynamic watermark preview)
- src/search/UniversalSearchService.ts (for 5a Cmd+K in composer and top bar)
- src/policy/AdminPolicyEngine.ts (for 5f enforcement in chat approvals)
- ui-admin/src/portal/pages/PolicyBuilderPage.tsx (rule builder for 5f)
- ui/src/components/chat/HuddleButton.tsx (for voice huddles with agent summary)
- tests/ThinkingBar.test.tsx, tests/ChainOfThought.test.ts, tests/ChatThreading.test.tsx, tests/MessageReactions.test.tsx (new focused tests)

Existing files modified:
- ui/src/components/StreamLikeChat.tsx (complete overhaul: replace separate agent reasoning bubbles with <ThinkingBar> for continuous chain of thought, integrate threading/reactions/suggested prompts/split view, use MissionThreadPanel for 5b, add biometric/redaction in cards, remove raw technical messages from main timeline, use human summaries and progressive disclosure for technical trace, integrate universal command bar for 5a, privacy mode, trust badges)
- ui/src/features/mission/MissionTimeline.tsx (add thread integration and progress visualization within thinking bar context)
- ui/src/components/consent/ConsentConsole.tsx (integrate into chat approval cards with biometric and redaction for 5c/5d, pull context from split view)
- ui/src/pages/InboxPage.tsx (ensure chat launcher and approvals link to enhanced chat with thinking bar)
- ui/src/components/CommandPalette.tsx (evolve to support universal Cmd+K in chat composer for 5a, natural language for missions/approvals)
- ui/src/hooks/queries.ts (add useThinkingBar, useThreadMessages, useSuggestedPrompts, useSplitViewContext, useReactions)
- ui/src/app/routes.tsx and ui/src/app/SectionContext.tsx (update to support chat threading and split view modes)
- ui/src/types/agentic.ts (add all new interfaces above)
- ui/tailwind.config.mjs (new tokens for thinking bar streaming accents, reaction bubbles, split view, huddle indicators, trust badges)
- src/server.ts (add endpoints for threads, reactions, suggested prompts, integrate policy and search for chat)
- src/notification/NotificationBridgeClient.ts (expand for chat-linked notifications for 5e)
- tests/e2e/chat-frontend.spec.js and tests/ChatFrontendWorkflow.test.ts (update for new thinking bar, threading, reactions, streaming, biometric/redaction flows, no raw bubbles)
- docs/frontend-chat-architecture.md and docs/frontend-redesign-plan.md (append this chat overhaul section with chain of thought, best practices from Slack/WhatsApp/Teams)
- AGENTS.md (add note on thinking bar testing and continuous reasoning validation)

Configuration updates: vite.config.ts (aliases for chat components), package.json (fuse.js, pdf-lib, additional lucide icons for reactions/huddles), public/manifest.json (PWA for mobile 5g with service worker for streaming/notifications).

[Functions]
Introduce 25 new functions and modify 18 existing ones to eliminate all roast problems (continuous chain of thought in one bar instead of separate bubbles, threading, reactions, suggested prompts, split view context, biometric/redaction in cards, universal command, trust/privacy indicators, streaming, progressive disclosure).

New functions:
- renderThinkingBar(state: ThinkingBarState, onStepExpand: (stepId: string) => void): JSX.Element in ui/src/components/chat/ThinkingBar.tsx (purpose: continuous streaming chain of thought bar that aggregates agent reasoning steps in one component instead of separate bubbles)
- streamChainOfThought(step: ChainOfThoughtStep, onUpdate: (text: string) => void): Promise<void> in ui/src/components/chat/ChainOfThoughtStream.tsx (purpose: LLM-driven streaming for continuous reasoning with human summaries and technical trace in expandable section)
- addMessageReaction(messageId: string, emoji: string): Promise<void> in ui/src/components/chat/MessageReactions.tsx (purpose: Slack-like reactions with count and users, realtime update)
- generateSuggestedPrompts(context: ChatContext): SuggestedPrompt[] in ui/src/components/chat/SuggestedPrompts.tsx (purpose: LLM-generated prompts below composer for common actions like "Approve with redaction" or "Ask for more context")
- renderChatSplitView(selectedMessage: ChatMessage | null): JSX.Element in ui/src/components/chat/ChatSplitView.tsx (purpose: right context panel with trust graph, risk, data movement, audit preview, memory used, biometric/redaction buttons)
- handleThreadReply(parentId: string, content: string): Promise<void> in ui/src/features/mission/MissionThreadPanel.tsx (purpose: 5b isolated threaded discussion with @mentions, realtime, separate from main timeline)
- performBiometricApprovalInChat(approvalId: string): Promise<boolean> in ui/src/components/consent/BiometricApproveButton.tsx (purpose: 5c WebAuthn/Windows Hello in chat approval cards)
- applyRedactionInChat(fileRequest: FileRequest, config: RedactionConfig): Promise<RedactedFile> in ui/src/components/vault/RedactionEditor.tsx (purpose: 5d redaction and watermark in file cards within chat)
- renderUniversalCommandBar(inChat: boolean): JSX.Element in ui/src/components/CommandPalette.tsx (purpose: 5a Cmd+K in composer and top, natural language for "stream reasoning for this mission")
- enforcePolicyInChat(rule: PolicyRule, action: string): boolean in src/policy/AdminPolicyEngine.ts (purpose: 5f enforcement for approvals in chat)
- togglePrivacyInChat(enabled: boolean): void in ui/src/hooks/queries.ts (purpose: mask technical details and sensitive content in thinking bar)
- summarizeChainOfThought(steps: ChainOfThoughtStep[]): string in ui/src/lib/agentic-utils.ts (purpose: human readable summary for thinking bar to replace raw bubbles)
- sendChatNotification(event: ChatEvent): Promise<void> in src/notification/NotificationService.ts (purpose: 5e rich notifications from chat events)
- useChatThinkingBar(missionId?: string): UseQueryResult<ThinkingBarState> in ui/src/hooks/queries.ts (purpose: TanStack realtime for continuous reasoning stream)
- renderHuddleButton(): JSX.Element in ui/src/components/chat/HuddleButton.tsx (purpose: voice huddle with agent summary per WhatsApp/ Slack best practices)

Modified functions:
- renderMessage(message: Message): JSX.Element in ui/src/components/StreamLikeChat.tsx (required changes: if agent reasoning use <ThinkingBar> for continuous chain of thought instead of separate bubbles, integrate reactions/threading/suggested prompts/split view, add biometric/redaction in embedded cards, use human summaries, progressive disclosure for technical steps, remove raw "Choose tool" bubbles, integrate universal command and privacy mode)
- renderTimeline(...) in ui/src/features/chat/StreamLikeChat.tsx (required changes: support threaded view for 5b, streaming for thinking bar, reactions on messages)
- handleConsent(...) in ui/src/components/consent/ConsentConsole.tsx (required changes: integrate into chat cards with biometric (5c), redaction (5d), policy (5f), context from split view)
- renderApprovalCard(...) in ui/src/pages/Approvals.tsx (required changes: embed in chat with thinking bar context, biometric and redaction buttons)
- getAgentRunSteps(...) in src/agent-runs/ (required changes: feed into ThinkingBar instead of separate messages)
- useMissions and useAgentRuns in ui/src/hooks/queries.ts (required changes: unify into useChatThinkingBar for continuous state to fix broken chain of thought)
- renderComposer() in ui/src/components/StreamLikeChat.tsx (required changes: add suggested prompts and universal command bar for 5a)
- registerChatRoutes in src/server.ts (required changes: add thread, reaction, suggested prompt endpoints, integrate policy and search)

Removed functions: renderSeparateAgentStep, renderRawThinkingBubble (reason: replaced by continuous ThinkingBar with streaming chain of thought; migration: all steps aggregated into one bar with expandable technicalTrace).

[Classes]
New React functional components (no inheritance, all use TanStack Query, shadcn, framer-motion for streaming animations, Zod for validation): ThinkingBar (key methods: renderStream, handleStepToggle, summarizeReasoning), ChainOfThoughtStream, MessageReactions, SuggestedPrompts, ChatSplitView (renderTrustGraph, renderRiskScore, renderDataBoundary), HuddleButton, ThreadedMessageList.

Modified classes: StreamLikeChat (specific modifications: conditional renderThinkingBar for agent messages instead of separate reasoning bubbles, add reactions/threading/split view/suggested prompts, integrate Phase 5 components for biometric/redaction/policy/search/notifications, use continuous state from workflow to maintain chain of thought, remove raw technical messages from main timeline, add privacy mode and trust badges), MissionTimeline (specific modifications: integrate with thinking bar for mission threads (5b), show progress within chain of thought), ConsentConsole (specific modifications: embed in chat with biometric and redaction, pull from split view context), CommandPalette (specific modifications: universal command in chat composer for 5a with natural language for reasoning prompts), HumanAuditLog (specific modifications: link from chat split view with compliance exports for 5f), IntentInbox (specific modifications: launch enhanced chat with thinking bar).

No removed classes.

[Dependencies]
Add fuse.js (^7.0.0) for universal search in command bar (5a), pdf-lib (^1.17.1) for redaction/watermark in chat file cards (5d), emoji-mart or lucide-react for reactions, framer-motion for thinking bar streaming animations, @web-authn for biometric (5c); update lucide-react for new icons (Brain, MessageCircleReply, ThumbsUp, Mic for huddles/thinking/reactions); update tailwind.config.mjs for thinking bar streaming colors, reaction bubbles, split view panels, trust accents; add PWA service worker enhancements for mobile streaming and pull-to-refresh (5g); no breaking changes to existing vite/tanstack/zod/shadcn.

[Testing]
Add 7 new focused Vitest test files (ThinkingBar.test.tsx for continuous chain of thought streaming and step aggregation, ChainOfThoughtStream.test.ts for progressive disclosure, MessageReactions.test.tsx, SuggestedPrompts.test.tsx, ChatSplitView.test.tsx for context panel, ChatThreading.test.tsx for 5b, BiometricRedactionInChat.test.ts for 5c/5d) in tests/; modify existing tests/ChatFrontendWorkflow.test.ts, tests/e2e/chat-frontend.spec.js, tests/AgentRun.test.ts to cover new thinking bar (no separate bubbles), threading, reactions, streaming, biometric/redaction in chat, policy enforcement, visual regression for new vs old bubble UI; run `npm test`, `npm run test:e2e`, typecheck, browser verification (desktop + mobile) after each feature; use mocked WebAuthn and streaming for tests; name tests FeatureName.test.ts per AGENTS.md; prioritize P0 tests for chain of thought continuity and no technical leakage.

[Implementation Order]
Implement in this order to first stabilize the continuous chain of thought data model and ThinkingBar (core fix for the roast's broken reasoning), then add supporting chat components (reactions, prompts, split view, threads), then integrate into StreamLikeChat to replace bubbles, then wire Phase 5 features (search/command, biometric/redaction, notifications, policy), finally mobile/testing/docs to ensure the chat feels seamless and competitive without breaking existing redesign or audit chain.

1. Update types in ui/src/types/agentic.ts and ui/src/types.ts with ChainOfThoughtStep, ThinkingBarState, MessageReaction, SuggestedPrompt, ChatSplitViewContext, ThreadedMessage, ChatViewMode + Zod schemas.
2. Create src/search/UniversalSearchService.ts and src/policy/AdminPolicyEngine.ts (for 5a command bar and 5f in chat approvals).
3. Create new chat components (ThinkingBar.tsx, ChainOfThoughtStream.tsx, MessageReactions.tsx, SuggestedPrompts.tsx, ChatSplitView.tsx, HuddleButton.tsx).
4. Create supporting Phase 5 components (MissionThreadPanel.tsx, BiometricApproveButton.tsx, RedactionEditor.tsx, WatermarkPreview.tsx).
5. Refactor ui/src/components/StreamLikeChat.tsx (main overhaul: replace separate reasoning bubbles with ThinkingBar for continuous chain of thought, add reactions/threading/split view/suggested prompts, integrate all Phase 5, remove raw technical messages, use human summaries and progressive disclosure).
6. Update MissionTimeline.tsx, ConsentConsole.tsx, CommandPalette.tsx, queries.ts, routes.tsx, server.ts, notification service to wire new functions and Phase 5 features.
7. Add privacy mode, human summary generator, streaming logic, thread storage, biometric/redaction in chat cards, huddle integration.
8. Update ui-admin for policy in chat context (5f) and add PWA for mobile (5g).
9. Update tailwind.config.mjs, integrate deps, add manifest for mobile.
10. Add all new test files and update existing for thinking bar continuity, streaming, reactions, threading, biometric/redaction in chat, full E2E flows.
11. Run npm run typecheck, npm test, npm run test:e2e, browser verification (desktop + mobile with streaming simulation), fix accessibility/linter issues.
12. Update docs/frontend-chat-architecture.md, docs/frontend-redesign-plan.md with this chat overhaul plan (including why continuous chain of thought was missing and how ThinkingBar fixes it), commit with Conventional Commits (e.g. feat(chat): continuous chain of thought thinking bar).

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