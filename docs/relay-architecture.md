# Relay Architecture

Oracle Amigo relay delivery is a control-plane mediated queue between local agents. The current runtime uses Postgres polling; Redis, NATS, SSE, and WebSocket are future transport options behind explicit seams.

## Task State Machine

`relay_tasks.status` is the public delivery state:

| State | Meaning |
| --- | --- |
| `accepted` | Sender request passed validation and was persisted. |
| `queued` | Task is eligible for receiver inbox polling. |
| `delivered_to_remote_agent` | Receiver fetched the task from the control plane. |
| `stored_by_remote_agent` | Receiver acked after writing the task/message locally. |
| `waiting_approval` | Receiver needs owner approval before continuing. |
| `approved` | Receiver owner approved the action. |
| `transfer_started` | File/data transfer has begun. |
| `completed` | Relay workflow completed. |
| `failed` | Delivery or workflow reached a terminal failure. |
| `expired` | TTL elapsed before completion. |

`relay_messages.status` is an internal delivery-attempt state: `queued`, `delivered`, `acked`, `responded`, `failed`, or `expired`.

## Idempotency

Send requests may include `idempotency_key`. The control plane enforces uniqueness on `(org_id, from_agent_instance_id, idempotency_key)`. A duplicate sender request returns the existing relay task/message instead of creating another task.

Receiver ack is idempotent after success. Repeated ack for an already stored or later-stage task returns the current task state and does not regress terminal or advanced states.

## Retry And Dead Letter

Inbox fetch claims eligible rows from Postgres with a transactional `FOR UPDATE SKIP LOCKED` query. A fetched task moves to `delivered_to_remote_agent`, increments `attempt_count`, and receives a `next_retry_at` computed from exponential backoff.

The local inbox poller only acks after dispatcher success (`created` or `duplicate`). If local dispatch fails, it does not ack. The task stays unacked and becomes retry-eligible after `next_retry_at`.

Defaults:

| Env var | Default |
| --- | --- |
| `RELAY_MAX_DELIVERY_ATTEMPTS` | `5` |
| `RELAY_RETRY_BASE_MS` | `5000` |
| `RELAY_RETRY_MAX_MS` | `300000` |
| `RELAY_TASK_TTL_SECONDS` | `86400` |

When `attempt_count >= max_attempts`, the task moves to `failed` with `last_error = max relay delivery attempts exhausted`. When `expires_at` passes, it moves to `expired`.

## Queue Abstraction

`apps/control-plane/src/relay/RelayQueue.ts` defines:

- `DbPollingRelayQueue`: production-capable current implementation using Postgres.
- `RedisRelayQueue`: placeholder only; it is not selectable for runtime until a Redis Streams implementation is added.

The queue owns enqueue, inbox claiming, expiry, and retry/dead-letter behavior. Relay service code owns authorization, idempotency, audit events, and task-state transitions.

## Metrics

Prometheus metrics:

- `control_plane_relay_queue_depth`
- `control_plane_relay_delivery_latency_seconds`
- `control_plane_relay_failed_count`
- `control_plane_relay_retry_count`

They are database-derived so they remain valid with DB polling and can later be backed by queue-driver metrics.

## Security And Tenancy

Every relay query is scoped by `org_id`. Sender and receiver agent instances must be active in the same organization. Admin/debug responses must not expose local paths, bearer tokens, encrypted key material, or raw secrets.
