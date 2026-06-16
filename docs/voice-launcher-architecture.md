# Oracle Amigo Quick Voice

Oracle Amigo Quick Voice is a separate Tauri v2 mini-launcher. It is intentionally a thin push-to-talk command surface: holding `Ctrl+Space` opens a compact black overlay, starts microphone capture, streams live speech text, and releasing `Ctrl+Space` submits the final transcript to the local agent.

The launcher does not implement relay, directory, approval, storage, or file-transfer logic. The local agent remains the source of truth and executes confirmed commands through existing chat, relay, approval, and transfer services.

## Runtime Flow

1. The launcher calls `GET /voice/status`.
2. If the local agent is unavailable, Tauri shell may run the allowlisted startup command only.
3. Rust-side global shortcut handling emits `voice:start` on `Ctrl+Space` press.
4. The window is sized to 420x180 and positioned bottom-right above the Windows taskbar.
5. The React UI starts microphone capture, renders a white waveform, and updates white live transcript text above the wave.
6. Rust-side global shortcut handling emits `voice:stop-and-submit` on `Ctrl+Space` release.
7. The launcher stops microphone capture, posts the transcript to `POST /voice/commands` with `mode: "auto_execute"`, then calls `POST /voice/commands/:id/confirm`.
8. Remote file requests reuse the existing cloud relay file-request path and still require the remote user approval before transfer.
9. The chat UI can list prior commands with `GET /voice/commands`, inspect a command with `GET /voice/commands/:id`, and subscribe to command-specific SSE with `GET /voice/commands/:id/events`.

## Security Boundaries

- No raw audio is persisted.
- Command records store transcripts, parse output, preview metadata, safe status, conversation id, mission id, and relay task id.
- Raw local paths, tokens, bearer headers, and secret-looking values are redacted from command errors.
- Tauri shell permissions allow only the local-agent startup command, not arbitrary shell execution.
- `Ctrl+Space` is the default push-to-talk shortcut.
- The overlay is hidden when idle and is not listed on the taskbar.

## Supported V1 Commands

- `Ask {person} to send me {file}`
- `Request {file} from {person}`
- `Send a file request to {person} for {file}`
- `Find {file} on my device`
- `Show pending approvals`
- `Open my inbox`
- `Open chat with {person}`
