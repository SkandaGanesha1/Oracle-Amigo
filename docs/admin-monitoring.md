# Admin Monitoring Guide

The control plane exposes a read-only admin API for inspecting the operational state of the deployment. This document covers the endpoints, what they show, and how to use them safely.

## Authentication

All `/admin/*` endpoints require the `X-Admin-Token` header. The token is set at startup via the `DEV_ADMIN_TOKEN` env var.

```bash
ADMIN_TOKEN="<your-DEV_ADMIN_TOKEN>"
curl http://127.0.0.1:8080/admin/users \
  -H "X-Admin-Token: $ADMIN_TOKEN"
```

In production, replace this with a short-lived admin JWT issued by your identity provider. The current implementation is intentionally minimal for the two-laptop demo.

## Endpoints

### `GET /admin/users`
Lists all users in the default org with their enrollment timestamps.
```json
{
  "users": [
    {
      "id": "uuid",
      "email": "alice@example.com",
      "displayName": "Alice",
      "createdAt": "2026-01-01T00:00:00.000Z"
    }
  ],
  "total": 1
}
```

### `GET /admin/devices`
Lists all enrolled devices with last-seen and trust state.
```json
{
  "devices": [
    {
      "id": "uuid",
      "userId": "uuid",
      "publicKeyFingerprint": "abc123...",
      "label": "Alice's Laptop",
      "createdAt": "...",
      "lastSeenAt": "..."
    }
  ],
  "total": 1
}
```

### `GET /admin/agent-instances`
Lists all agent instances (a device may host multiple agents; an agent may be active on multiple devices).
```json
{
  "instances": [
    {
      "id": "uuid",
      "agentId": "uuid",
      "deviceId": "uuid",
      "status": "active",
      "lastHeartbeat": "...",
      "capabilities": ["a2a.v1", "anp.handshake.v1"]
    }
  ],
  "total": 1
}
```

### `GET /admin/presence`
Aggregates presence across all agent instances in the org. Useful for "who's online right now?" dashboards.
```json
{
  "presence": [
    {
      "agentInstanceId": "uuid",
      "agentId": "uuid",
      "status": "online",            // "online" | "stale" | "offline"
      "lastSeenAt": "..."
    }
  ],
  "total": 1,
  "onlineCount": 1
}
```

### `GET /admin/tasks`
Lists relay tasks (cross-device A2A messages routed through the control plane).
```json
{
  "tasks": [
    {
      "id": "uuid",
      "fromAgentInstanceId": "uuid",
      "toAgentInstanceId": "uuid",
      "type": "a2a.v1.message",
      "status": "delivered",          // "pending" | "delivered" | "acked" | "failed"
      "createdAt": "...",
      "deliveredAt": "...",
      "ackedAt": "..."
    }
  ],
  "total": 1
}
```

### `GET /admin/transfers`
Lists file transfers, including those that expired without download.
```json
{
  "transfers": [
    {
      "id": "uuid",
      "fromUserId": "uuid",
      "toUserId": "uuid",
      "fileName": "report.pdf",
      "size": 102400,
      "sha256": "abc...",
      "status": "completed",          // "pending" | "uploaded" | "downloaded" | "expired"
      "createdAt": "...",
      "expiresAt": "..."
    }
  ],
  "total": 1
}
```

### `GET /admin/audit`
Paginates audit events in reverse chronological order.
Query params: `limit` (default 100, max 1000), `before` (ISO 8601 cursor).
```json
{
  "events": [
    {
      "id": "uuid",
      "orgId": "uuid",
      "actorUserId": "uuid | null",
      "actorAgentInstanceId": "uuid | null",
      "eventType": "user.signed_up",
      "details": { "email": "..." },
      "previousHash": "...",
      "eventHash": "...",
      "createdAt": "..."
    }
  ],
  "nextCursor": "2026-01-01T00:00:00.000Z"
}
```

### `GET /admin/audit/verify`
Verifies the SHA-256 hash chain. Returns `{ valid: true }` if the chain is intact.
```bash
curl http://127.0.0.1:8080/admin/audit/verify -H "X-Admin-Token: $ADMIN_TOKEN"
# → { "valid": true, "eventsChecked": 1234 }
```

If `valid: false`, the response includes the index of the first broken hash — investigate immediately.

## Operational Recipes

### "Is agent B still online?"
```bash
curl http://127.0.0.1:8080/admin/presence \
  -H "X-Admin-Token: $ADMIN_TOKEN" \
  | jq '.presence[] | select(.agentId == "<agent-B-id>")'
```

### "What did agent A do in the last hour?"
```bash
ONE_HOUR_AGO=$(date -u -d '1 hour ago' +"%Y-%m-%dT%H:%M:%S.000Z")
curl "http://127.0.0.1:8080/admin/audit?limit=200&before=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")" \
  -H "X-Admin-Token: $ADMIN_TOKEN" \
  | jq ".events[] | select(.actorAgentInstanceId == \"<agent-A-instance-id>\") | select(.createdAt > \"$ONE_HOUR_AGO\")"
```

### "Are there any stuck relay tasks?"
```bash
curl http://127.0.0.1:8080/admin/tasks -H "X-Admin-Token: $ADMIN_TOKEN" \
  | jq '.tasks[] | select(.status == "pending")'
```

### "Did the audit chain get tampered with?"
```bash
curl http://127.0.0.1:8080/admin/audit/verify -H "X-Admin-Token: $ADMIN_TOKEN"
```

## Security Notes

- The admin token has full read access to all org data, including message metadata. Treat it like a root credential.
- All admin queries are org-scoped (no cross-tenant reads), but there's no row-level audit of admin access — log outbound calls to the admin API in your reverse proxy.
- For multi-org deployments, the token currently grants access to the default org only. To extend, replace `requireAdmin` with a token that carries an `orgId` claim and validate it per request.

## What admin does NOT expose

- File contents (only metadata: name, size, sha256, timestamps).
- Local file paths on the agent machines.
- Private keys, password hashes, or refresh-token hashes.
- The decrypted payload of in-flight A2A messages.

These are deliberately kept out of scope; an admin compromise should not become a data-exfiltration vector.
