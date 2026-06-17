# Voice Command Parser

Oracle Amigo Quick Voice uses deterministic parsing first and OCI GenAI structured parsing as fallback. The launcher sends text to the local agent; the local agent owns parsing, directory resolution, policy, relay, and audit.

## Supported Commands

- `Ask {person} to send me {file}`
- `Request {file} from {person}`
- `Send a file request to {person} for {file}`
- `Find {file} on my device`
- `Show pending approvals`
- `Open my inbox`
- `Open chat with {person}`
- `Show files received from {person}`

## Remote File Request Shape

Input:

```text
Ask Docin to send me NonPO invoice india.pdf file
```

Parsed result:

```json
{
  "intent": "remote_file_request",
  "targetPersonQuery": "Docin",
  "fileQuery": "NonPO invoice india.pdf",
  "confidence": 0.94,
  "requiresConfirmation": true
}
```

The service then resolves `targetPersonQuery` through the directory and returns a preview. Confirmation sends the existing relay file-request flow. Files are not transferred until the remote user approves a bound candidate.

## OCI GenAI Fallback

Low-confidence rule parses call the shared OCI GenAI provider configured by `OCI_GENAI_MODEL_ID`, `OCI_GENAI_SERVICE_ENDPOINT`, `OCI_GENAI_COMPARTMENT_ID`, and the OCI config/profile or `OCI_GENAI_API_KEY`. The parser validates model output with Zod, retries once for malformed JSON, and rejects any response that does not keep `requesterReference` as `current_user`.

## Unsupported Commands

Unsupported or ambiguous transcripts return `intent: "unknown"` with `requiresConfirmation: true` and an error message. They do not execute relay, file, approval, or storage actions.
