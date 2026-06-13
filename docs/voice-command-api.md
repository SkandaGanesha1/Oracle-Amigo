# Voice Command API

The local agent exposes a preview-first voice command API for the separate Oracle Amigo Quick Voice launcher.

## Endpoints

- `GET /voice/status`
- `POST /voice/commands`
- `GET /voice/commands/:id`
- `POST /voice/commands/:id/confirm`
- `POST /voice/commands/:id/cancel`

`POST /voice/commands` accepts:

```json
{
  "transcript": "Ask Docin to send me NonPO invoice india.pdf file",
  "source": "voice-launcher",
  "mode": "preview_then_execute",
  "sttConfidence": 0.91
}
```

The response stores a safe command record and returns a preview. Remote file requests are not executed until `confirm` is called.

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
