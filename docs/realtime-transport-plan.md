# Realtime Transport Plan

Polling remains the default Oracle Amigo realtime mechanism. The relay hardening work adds seams for SSE and later WebSocket support without requiring either transport for current functionality.

## Current Default: Polling

Local agents poll `GET /v1/relay/a2a/inbox` with a device token. The control plane claims retry-eligible work from Postgres and redelivers unacked tasks after backoff.

The chat UI already has `PollingTransport`, `SseTransport`, and `WebSocketTransport`. It uses polling unless a same-origin SSE URL is explicitly configured.

## Control-Plane Realtime Seam

`apps/control-plane/src/relay/RelayRealtime.ts` defines a `RelayRealtime` publisher/subscriber contract and `NoopRelayRealtime` default. The no-op default is intentional: Postgres polling is the active delivery path, while future SSE/WebSocket fanout can subscribe to relay events without changing relay state logic.

Event shape:

```json
{
  "kind": "relay_message_available",
  "org_id": "org_...",
  "agent_instance_id": "agi_...",
  "relay_task_id": "rt_...",
  "status": "queued",
  "timestamp": "2026-06-18T00:00:00.000Z",
  "payload": {}
}
```

## SSE Design

Future endpoint:

```http
GET /v1/relay/a2a/events
Authorization: Bearer <device token>
Accept: text/event-stream
```

Behavior:

- Authenticate with device auth and derive `org_id` plus `agent_instance_id`.
- Emit only events for that org and receiver agent instance.
- Send heartbeat comments to keep intermediaries from closing idle connections.
- Include event `id` for resume and `retry` hints for browser reconnect.
- Fall back to polling on client errors or unsupported browsers.

Initial events:

- `relay_message_available`
- `relay_task_updated`
- `relay_task_failed`
- `relay_task_expired`

## WebSocket Placeholder

No WebSocket server is implemented in this phase. WebSocket can be considered later for bidirectional agent telemetry, but relay delivery must continue to work through polling and SSE.

## Redis/NATS Future

Redis Streams or NATS JetStream can replace DB polling behind `RelayQueue` when operational requirements justify a dedicated broker. Required guarantees before enabling either:

- durable message persistence;
- receiver ack and redelivery;
- idempotent producer keys;
- tenant-scoped stream/subject naming;
- bounded retry and dead-letter policy;
- metrics parity with DB polling.
