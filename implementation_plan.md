# Implementation Plan

[Overview]
The goal is to fix the Ctrl+Space PTT flickering on key hold and make the live transcript + waveform visualization perfectly center-aligned in the Oracle Amigo voice interface (matching the provided black rounded screenshot design).

The existing implementation incorrectly treats voice listening as a standard right-aligned user message bubble (using flex justify-end or message variant styling in the chat container and message components). This causes the transcript and yellow waveform to hug the right edge. Additionally, the key event handlers do not filter `e.repeat` or maintain proper pressed-state flags, causing rapid open/close toggling when holding Ctrl+Space due to browser repeat events. This advanced implementation introduces a dedicated centered listening overlay with smooth CSS/JS waveform animation (12 yellow bars with dynamic heights), robust PTT state machine using key flags, real-time transcript streaming, escape-to-cancel, and seamless integration with the existing React UI stack (PromptInput, ChatContainer, message rendering, and src/voice service) while preserving all existing chat, StickToBottom, and A2A functionality.

[Types]
Introduce dedicated types for stable PTT handling, centered voice UI state, and waveform configuration to enable accurate center alignment and advanced visualization.

```ts
interface VoiceListeningState {
  isActive: boolean;
  transcript: string; // live STT output, max 180 chars with ellipsis truncation
  audioLevel: number; // normalized 0.0-1.0 from Web Audio API or mock
  isPTTHeld: boolean; // prevents repeat-induced flicker
  startTime: Date;
  waveformBars: WaveformBar[];
}

interface WaveformBar {
  height: number; // 4-48px dynamic based on audioLevel with easing
  delay: number; // staggered animation delay in ms
}

type MessageVariant = 'user' | 'assistant' | 'system' | 'voice-listening';

interface VoiceUIConfig {
  barCount: 12;
  maxWidth: '420px';
  bgColor: 'bg-zinc-950 border border-zinc-800';
  accentColor: '#facc15'; // yellow-400 matching screenshot
  alignment: 'center'; // forces mx-auto + flex justify-center or fixed centered overlay
  animationDuration: 180; // ms per cycle
  // Validation rules: audioLevel = Math.max(0, Math.min(1, rawLevel)), transcript sanitized
}
```

[Files]
Create 2 new files and modify 6 existing files with precise changes for the centered voice UI and stable PTT.

- **New files to be created:**
  - hooks/use-voice-ptt.ts: Custom hook managing key flags, listening state, and audio level simulation (full path: @/hooks/use-voice-ptt.ts)
  - components/ui/voice-listening.tsx: Self-contained centered black panel component with animated yellow waveform (12 bars), live transcript, and exact visual match to screenshot (full path: @/components/ui/voice-listening.tsx)

- **Existing files to be modified:**
  - @/components/ui/prompt-input.tsx: Add useVoicePTT integration, extend context with VoiceListeningState, update handleKeyDown to use flags and prevent repeat, expose isListening to parent
  - @/components/ui/message.tsx: Add 'voice-listening' variant that renders <VoiceListening /> with center alignment (mx-auto, max-w-[420px], remove justify-end)
  - @/components/ui/chat-container.tsx: Add optional `showVoiceOverlay` prop and conditional rendering of centered VoiceListening outside the normal message flow when active
  - src/voice/voice-service.ts: Extend to support centered UI events, improve real-time transcript emission to VoiceListeningState, add cancelPTT method
  - ui/src/App.tsx (main chat orchestrator): Wire useVoicePTT hook, manage global listening state, pass to PromptInput and ChatContainer, handle Escape key globally
  - docs/frontend-chat-architecture.md: Add section documenting the new centered voice pattern, PTT state machine, and alignment rules
  - tests/e2e/chat-frontend.spec.js: Add tests for hold stability and center alignment verification

- No files will be deleted or moved. Configuration files (tailwind.config, tsconfig) require no changes.

[Functions]
All changes focus on robust key handling (using pressed flags + repeat filter) and a new centered rendering path.

- **New functions:**
  - useVoicePTT(): hooks/use-voice-ptt.ts - (signature: () => VoiceListeningState & { startPTT: () => void, stopPTT: () => void }). Uses useState for isPTTHeld/isActive, useEffect for document.addEventListener('keydown'/'keyup'), filters e.repeat, simulates audioLevel with setInterval during active state.
  - renderWaveform(state: VoiceListeningState): JSX.Element - components/ui/voice-listening.tsx - Maps 12 bars with CSS transform scaleY and staggered transition-delay for organic pulsing effect.
  - createVoiceBubble(transcript: string, audioLevel: number): JSX.Element - components/ui/voice-listening.tsx - Returns exact black rounded container (rounded-3xl, shadow-2xl, yellow dots/wave) centered via Tailwind.

- **Modified functions:**
  - handleKeyDown in @/components/ui/prompt-input.tsx: Replace existing Ctrl+Space logic with call to useVoicePTT().handleKey(e); add `if (e.repeat && isPTTHeld) return;` to eliminate flicker.
  - renderMessage or equivalent in @/components/ui/message.tsx: Add case `if (variant === 'voice-listening') return <VoiceListening {...state} />;` with center classes instead of right alignment.
  - updateListeningUI in src/voice/voice-service.ts: Change from pushing right-aligned message to updating centralized VoiceListeningState and triggering re-render in UI.
  - adjustHeight in @/components/ui/prompt-input.tsx: Add logic to collapse input area height when voice overlay is active.

- **Removed functions:** Legacy togglePTT() in prompt-input (migrated entirely to useVoicePTT hook with proper state machine to avoid race conditions).

[Classes]
No structural class changes needed (codebase is hook-based). The existing VoiceService class/instance in src/voice/voice-service.ts will gain two new methods: `enterCenteredListeningMode()` and `updateCenteredTranscript(transcript: string, level: number)` that emit events consumed by the React context. No inheritance or removal of classes.

[Dependencies]
No new packages required. Leverages existing Tailwind (flex, mx-auto, fixed inset-0 flex items-center justify-center for overlay), React hooks, and lucide-react (optional Mic icon). If smoother bar animations are desired, framer-motion (already in UI deps) can be used for the waveform; otherwise pure CSS @keyframes with Tailwind arbitrary values. Web Audio API used for real audioLevel if microphone permission granted (fallback to simulated sine wave).

[Testing]
Test both visual centering accuracy and PTT hold stability with zero tolerance for flickering.

- New test file: tests/voice-ptt-hold.test.ts - Tests holding Ctrl+Space for 10s+ with no state toggling, transcript updates every 300ms, Escape cancels cleanly, and audioLevel drives waveform heights.
- Update tests/e2e/chat-frontend.spec.js: Add Playwright steps that simulate native Ctrl+Space hold, assert computed style `marginLeft`/`marginRight` are equal (true center), and screenshot comparison against provided image.
- Snapshot test in tests/Ui.test.ts for VoiceListening component matching exact visual (black bg, yellow bars, font, rounded-3xl, shadow).
- Edge cases: long transcript wrapping, zero audioLevel (flat waveform), permission denied, rapid key spam, integration with existing StickToBottom scroll behavior (overlay must not break chat history).

[Implementation Order]
Implement in this strict sequence to avoid conflicts between key handling, state, and rendering layers:

1. Create hooks/use-voice-ptt.ts with complete state machine, key flag tracking (isCtrlPressed + isSpacePressed), repeat filtering, and audioLevel simulation.
2. Create components/ui/voice-listening.tsx implementing the exact screenshot design (black panel, centered yellow animated waveform using 12 bars + CSS transitions, live transcript with ellipsis).
3. Modify @/components/ui/prompt-input.tsx to integrate useVoicePTT hook, extend context, and update key handlers + input collapse logic.
4. Modify @/components/ui/message.tsx and @/components/ui/chat-container.tsx to support 'voice-listening' variant and centered overlay rendering (using mx-auto or fixed center positioning).
5. Update src/voice/voice-service.ts to feed real-time data into the new centered state.
6. Update main chat orchestrator (ui/src/App.tsx or equivalent) and docs/frontend-chat-architecture.md.
7. Add all new tests and run full test suite + manual hold verification in browser.
8. Final visual validation that transcript and waves remain perfectly centered and PTT is stable on hold.