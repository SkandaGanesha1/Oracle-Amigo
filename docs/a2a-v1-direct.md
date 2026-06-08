# A2A v1.0.0 Direct Implementation

Oracle Amigo implements the [A2A v1.0.0 protocol](https://github.com/a2aproject/A2A/tree/v1.0.0) **directly** — without any v0.3 wrapper, compatibility adapter, or v0.3→v1 mapping layer. This document describes how the v1.0.0 spec is realized on top of the local agent.

## Why v1.0.0 and not v0.3?

Per the project direction, A2A v1.0.0 is implemented natively. The v0.3 types live in `src/protocol/a2a/` and are kept around only for legacy internal calls; they are not bridged to v1.0.0. New external clients speak v1.0.0.

## Proto Source of Truth

The single source of truth for the spec is the v1.0.0 proto file:
- `https://github.com/a2aproject/A2A/raw/refs/tags/v1.0.0/specification/a2a.proto`
- `package lf.a2a.v1;`
- Proto3 with `google.api.http` annotations, multi-tenancy via `/{tenant}/` URL prefix.

The TypeScript types in `src/protocol/a2a-v1/types.ts` are a 1:1 mirror of that proto (oneofs modeled as discriminated unions, enums as string literal unions, etc.).

## Endpoints

| Spec path | Method | Implementation |
| --- | --- | --- |
| `/.well-known/agent-card.json` | `GET` | Public Agent Card |
| `/v1/extendedAgentCard` | `GET` | Authenticated extended card |
| `/v1/message:send` | `POST` | `SendMessage` |
| `/v1/message:stream` | `POST` | `SendStreamingMessage` (SSE) |
| `/v1/tasks` | `GET` | `ListTasks` (cursor pagination) |
| `/v1/tasks/{id}` | `GET` | `GetTask` |
| `/v1/tasks/{id}:cancel` | `POST` | `CancelTask` |
| `/v1/tasks/{id}:subscribe` | `POST` | `SubscribeToTask` (SSE) |
| `/v1/tasks/{id}/pushNotificationConfigs` | `POST` / `GET` | Create / list |
| `/v1/tasks/{id}/pushNotificationConfigs/{configId}` | `GET` / `DELETE` | Get / delete |

All endpoints also accept the multi-tenant `/{tenant}/` prefix (e.g. `/acme-corp/v1/message:send`).

## Request & Response Wire Format

- **Media type**: `application/a2a+json`
- **Version header**: `A2A-Version: 1.0`
- **Extensions header**: `A2A-Extensions: <comma-separated>` (optional)
- **Timestamps**: ISO 8601 with millisecond precision (`2026-06-07T12:34:56.789Z`)

## Task States

SCREAMING_SNAKE_CASE enums (per proto v1.0.0):

```
TASK_STATE_UNSPECIFIED
TASK_STATE_SUBMITTED
TASK_STATE_WORKING
TASK_STATE_INPUT_REQUIRED
TASK_STATE_COMPLETED
TASK_STATE_FAILED
TASK_STATE_REJECTED
TASK_STATE_CANCELED
TASK_STATE_AUTH_REQUIRED
TASK_STATE_UNKNOWN
```

`isTerminalV1State()` in `types.ts` returns `true` for `COMPLETED`, `FAILED`, `REJECTED`, `CANCELED`, and `UNKNOWN`.

## Streaming

`POST /v1/message:stream` returns `text/event-stream`. Each event is a `SendStreamingMessageResponse` oneof:

```json
data: {"task": {"id": "...", "contextId": "...", "status": {"state": "TASK_STATE_WORKING", "timestamp": "..."}}}
```

```json
data: {"statusUpdate": {"taskId": "...", "status": {"state": "TASK_STATE_COMPLETED", "timestamp": "..."}, "final": true}}
```

```json
data: {"artifactUpdate": {"taskId": "...", "artifact": {"artifactId": "...", "parts": [...]}, "append": false, "lastChunk": true}}
```

## Fastify Path Handling

A2A v1 spec URLs use colon verbs (`/v1/message:send`). Fastify's router (find-my-way) normalizes colons as parameter delimiters, so we register a `rewriteUrl` callback at Fastify construction time that rewrites the colon verbs to internal underscore paths before routing.

```ts
Fastify({ rewriteUrl: getA2Av1UrlRewriter() })
```

The rewriter also handles the `/{tenant}/` prefix (e.g. `/acme-corp/v1/tasks/abc:cancel` → `/acme-corp/v1/tasks/cancel/abc`).

A custom content-type parser is registered for `application/a2a+json` so Fastify accepts the v1 media type (default is `application/json` only).

## Security

- **Agent Card signing**: Optional JWS RS256 signature (RFC 7515). `signCardWithRs256(card, privateKey)` signs canonical JSON of the card with `signatures` excluded. Protected headers use `typ: "JOSE"`.
- **Push notification authentication**: `buildPushNotificationHeaders(config, body)` produces headers including `X-A2A-Notification-Token` (opaque token) and `Authorization: Bearer <token>` or `Basic <base64>` based on the config's `authentication` block.
- **Extended card**: `/v1/extendedAgentCard` is gated on `supportsAuthenticatedExtendedCard`. Returns 401 (`AUTHENTICATED_EXTENDED_CARD_NOT_CONFIGURED`) when disabled.

## Error Codes

RFC 7807 problem details (`application/problem+json`):

| Code | Constant | Meaning |
| --- | --- | --- |
| `-32001` | `TASK_NOT_FOUND` | Task ID not found |
| `-32002` | `TASK_NOT_CANCELABLE` | Cannot cancel a terminal task |
| `-32003` | `PUSH_NOTIFICATION_NOT_SUPPORTED` | Agent does not support push |
| `-32004` | `UNSUPPORTED_OPERATION` | Operation not in capabilities |
| `-32005` | `CONTENT_TYPE_NOT_SUPPORTED` | Media type not accepted |
| `-32006` | `INVALID_AGENT_RESPONSE` | Internal agent error |
| `-32007` | `AUTHENTICATED_EXTENDED_CARD_NOT_CONFIGURED` | Extended card not enabled |

`v1Error(reply, code, message, data?)` builds the response with the right shape.

## Code Layout

- `src/protocol/a2a-v1/types.ts` — proto-mirror types
- `src/protocol/a2a-v1/AgentCardV1.ts` — card builder + JWS sign/verify + canonicalize
- `src/protocol/a2a-v1/A2Av1Handler.ts` — `A2Av1Handler` class with `A2Av1Context` interface
- `src/protocol/a2a-v1/A2Av1StreamHandler.ts` — SSE streamer + event helpers
- `src/protocol/a2a-v1/A2Av1PushNotificationHandler.ts` — push notification store + delivery
- `src/protocol/a2a-v1/A2Av1Routes.ts` — Fastify route registration + `getA2Av1UrlRewriter()`
- `src/server.ts` — wires v1 card + push store + ctx + `registerA2Av1Routes(server, handler)`
- `tests/A2Av1.test.ts` — 28 tests (types, JWS round-trip, card, push store, full HTTP+JSON integration, SSE)

## Example: Send a Message

```bash
curl -X POST http://localhost:3399/v1/message:send \
  -H "Content-Type: application/a2a+json" \
  -H "A2A-Version: 1.0" \
  -d '{
    "message": {
      "messageId": "11111111-1111-1111-1111-111111111111",
      "role": "ROLE_USER",
      "parts": [{"text": "Search my files for invoices"}]
    }
  }'
```

```json
{
  "task": {
    "id": "22222222-2222-2222-2222-222222222222",
    "contextId": "33333333-3333-3333-3333-333333333333",
    "status": {
      "state": "TASK_STATE_COMPLETED",
      "timestamp": "2026-06-07T12:34:56.789Z"
    },
    "artifacts": [
      {
        "artifactId": "result-1",
        "parts": [{"text": "Found 3 invoices..."}]
      }
    ]
  }
}
```

## Example: Stream a Message

```bash
curl -N -X POST http://localhost:3399/v1/message:stream \
  -H "Content-Type: application/a2a+json" \
  -H "A2A-Version: 1.0" \
  -d '{
    "message": {
      "messageId": "...",
      "role": "ROLE_USER",
      "parts": [{"text": "Stream a long analysis"}]
    }
  }'
```

Returns `text/event-stream` with one `data:` frame per event.

## Migration Notes

- **No v0.3 → v1 mapping layer**: existing v0.3 internal calls in `src/protocol/a2a/` are not bridged. If you need to call a v0.3 endpoint, you must use the v0.3 types directly.
- **Path changes**: `/v1/message:send` (v1) replaces the v0.3 JSON-RPC `/a2a` endpoint.
- **Media type**: `application/a2a+json` replaces v0.3's `application/json` for A2A calls.
- **Enums**: Task states are SCREAMING_SNAKE_CASE in v1.0.0 (e.g. `TASK_STATE_WORKING`), camelCase in v0.3 (`working`).
- **Member polymorphism**: v1 uses member-based polymorphism with the actual `text`/`file`/`data` field. Generated v1 wire payloads do not include a discriminator field.
