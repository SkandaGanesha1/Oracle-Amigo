# Voice Command API

The local agent exposes a voice command API for the separate Oracle Amigo Quick Voice launcher. The launcher is preview-first: it captures or transcribes input, asks the local agent to create a command preview, and confirms only after user review.

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
  "mode": "preview_then_execute",
  "locale": "en-IN",
  "input_mode": "speech",
  "stt": {
    "provider": "browser",
    "confidence": 0.91
  }
}
```

The response stores a safe command record and returns a preview. The launcher shows the preview and calls `POST /voice/commands/:id/confirm` only when the user approves it. Remote file requests then enter the existing relay flow; the remote user still approves before any file transfer.

`GET /voice/commands` returns recent command history with `commands` and `pageInfo`. Each command stores its linked `conversationId`, `missionId`, and `relayTaskId` when execution creates downstream work. `GET /voice/commands/:id/events` streams command lifecycle events, while `/events` emits normalized `voice_command_update` snapshots for the main React Query cache.

## Parser And LLM Provider

Voice parsing is rule-first with OCI GenAI fallback through the shared `src/oci/LlmProvider.ts` abstraction. Do not configure a direct OpenAI API key for Quick Voice. Use the same OCI settings as the rest of the local agent:

```dotenv
OCI_GENAI_MODEL_ID="openai.gpt-5.2"
OCI_GENAI_SERVICE_ENDPOINT="https://inference.generativeai.us-chicago-1.oci.oraclecloud.com"
OCI_GENAI_COMPARTMENT_ID="..."
OCI_AUTH_TYPE="API_KEY"
OCI_CONFIG_FILE="C:\\Users\\...\\.oci\\config"
OCI_CONFIG_PROFILE="DEFAULT"
OCI_EMBEDDING_MODEL_ID="openai.text-embedding-3-large"
```

The model returns structured JSON only. Zod validation enforces `requesterReference: "current_user"` so the LLM cannot invent requester identity or execute actions.

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
