# Oracle Amigo Quick Voice

Oracle Amigo Quick Voice is a separate Tauri v2 mini-launcher. It is intentionally a thin command surface: it captures typed or spoken intent, asks the local agent for a preview through `/voice/commands`, and confirms through `/voice/commands/:id/confirm`.

The launcher does not implement relay, directory, approval, storage, or file-transfer logic. The local agent remains the source of truth and executes confirmed commands through existing chat, relay, approval, and transfer services.

## Runtime Flow

1. The launcher calls `GET /voice/status`.
2. If the local agent is unavailable, Tauri shell may run the allowlisted startup command only.
3. The user types a command or uses microphone capture for waveform feedback.
4. The launcher posts the transcript to `POST /voice/commands`.
5. The local agent stores a safe command record and returns a preview.
6. Confirmation calls `POST /voice/commands/:id/confirm`.
7. Remote file requests reuse the existing cloud relay file-request path and still require the remote user approval before transfer.

## Security Boundaries

- No raw audio is persisted.
- Command records store transcripts, parse output, preview metadata, safe status, conversation id, and relay task id.
- Raw local paths, tokens, bearer headers, and secret-looking values are redacted from command errors.
- Tauri shell permissions allow only the local-agent startup command, not arbitrary shell execution.
- `Ctrl+Space` is the default shortcut and is configurable in launcher local storage under `oa-voice-shortcut-v1`.

## Supported V1 Commands

- `Ask {person} to send me {file}`
- `Request {file} from {person}`
- `Send a file request to {person} for {file}`
- `Find {file} on my device`
- `Show pending approvals`
- `Open my inbox`
- `Open chat with {person}`
