# Voice Command API

The local agent exposes a voice command API for the separate Oracle Amigo Quick Voice launcher. The current launcher uses push-to-talk auto-submit, while the API still supports preview-first callers.

## Endpoints

- `GET /voice/status`
- `GET /voice/commands`
- `POST /voice/commands`
- `GET /voice/commands/:id`
- `GET /voice/commands/:id/events`
- `POST /voice/commands/:id/confirm`
- `POST /voice/commands/:id/cancel`

`POST /voice/commands` accepts:

```json
{
  "transcript": "Ask Docin to send me NonPO invoice india.pdf file",
  "source": "voice-launcher",
  "mode": "auto_execute",
  "locale": "en-IN",
  "sttConfidence": 0.91
}
```

The response stores a safe command record and returns a preview. The push-to-talk launcher immediately calls `POST /voice/commands/:id/confirm` after capture. Remote file requests then enter the existing relay flow; the remote user still approves before any file transfer.

`GET /voice/commands` returns recent command history with `commands` and `pageInfo`. Each command stores its linked `conversationId`, `missionId`, and `relayTaskId` when execution creates downstream work. `GET /voice/commands/:id/events` streams command lifecycle events, while `/events` emits normalized `voice_command_update` snapshots for the main React Query cache.

## Execution Rules

- The launcher never sends files directly.
- Remote file requests call the existing cloud relay file-request path.
- The receiver still searches local allowed roots, creates a bound approval, and requires human approval before transfer.
- Raw audio is not stored.
- Raw local paths, bearer tokens, and secret-looking values are redacted from command records and errors.

## Supported Commands

- `Ask {person} to send me {file}`
- `Request {file} from {person}`
- `Send a file request to {person} for {file}`
- `Find {file} on my device`
- `Show pending approvals`
- `Open my inbox`
- `Open chat with {person}`
