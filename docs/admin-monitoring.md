# Admin Monitoring Guide

The control plane exposes a read-only admin API for inspecting the operational state of the deployment. This document covers the endpoints, what they show, and how to use them safely.

> **Operator UI:** the recommended way to consume these endpoints is the **Admin Portal** — a standalone React app with first-class operator auth (Argon2id password + TOTP 2FA + recovery codes + HttpOnly session cookie). See [`admin-portal.md`](./admin-portal.md) for the full setup, security model, and troubleshooting. The `curl` examples below are for scripting and incident response.

## Authentication

All `/v1/admin/*` data endpoints accept **either** a valid session cookie (set by `/v1/admin/auth/login` + `/v1/admin/auth/mfa/verify`) **or** the `X-Admin-Token` header. The header is set at startup via `DEV_ADMIN_TOKEN` (or `ADMIN_BOOTSTRAP_TOKEN` in prod) and is intended for scripting and incident response only — operators should use the portal.

```bash
# Session cookie (preferred for repeated calls):
curl -c /tmp/admin.jar http://127.0.0.1:8080/v1/admin/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"..."}'
# → 200 {"status":"mfa_required",...}  then verify TOTP, then:
curl -b /tmp/admin.jar http://127.0.0.1:8080/v1/admin/users

# Bootstrap token (scripting, no MFA):
curl http://127.0.0.1:8080/v1/admin/users \
  -H "X-Admin-Token: $DEV_ADMIN_TOKEN"
```

In production, the session cookie path is preferred because it carries an audited operator identity. The bootstrap token is a single shared secret; rotate it via the env var.

## Endpoints

### `GET /v1/admin/info`
Returns control-plane build info (version, uptime, DB path, env).
```json
{
  "version": "0.1.0",
  "uptimeSeconds": 12345,
  "dbPath": "/var/lib/oracle-amigo/control-plane.sqlite",
  "nodeEnv": "production"
}
```

### `GET /v1/admin/users`
Lists all users across all orgs with their enrollment timestamps.
```json
{
  "users": [
    {
      "id": "uuid",
      "orgId": "uuid",
      "email": "alice@example.com",
      "displayName": "Alice",
      "createdAt": "2026-01-01T00:00:00.000Z"
    }
  ]
}
```

### `GET /v1/admin/devices`
Lists all enrolled devices with last-seen and trust state.
```json
{
  "devices": [
    {
      "id": "uuid",
      "orgId": "uuid",
      "userId": "uuid",
      "ownerEmail": "alice@example.com",
      "orgSlug": "default",
      "publicKeyFingerprint": "abc123...",
      "deviceName": "Alice's Laptop",
      "createdAt": "...",
      "lastSeenAt": "..."
    }
  ]
}
```

### `GET /v1/admin/agent-instances`
Lists all agent instances (a device may host multiple agents; an agent may be active on multiple devices).
```json
{
  "instances": [
    {
      "id": "uuid",
      "agentId": "uuid",
      "deviceId": "uuid",
      "agentDisplayName": "...",
      "deviceName": "...",
      "ownerEmail": "alice@example.com",
      "status": "active",
      "lastHeartbeatAt": "...",
      "capabilities": ["a2a.v1", "anp.handshake.v1"]
    }
  ]
}
```

### `GET /v1/admin/presence`
Aggregates presence across all agent instances in the org. Useful for "who's online right now?" dashboards.
```json
{
  "presence": [
    {
      "agentInstanceId": "uuid",
      "agentId": "uuid",
      "deviceId": "uuid",
      "deviceName": "...",
      "ownerEmail": "...",
      "status": "online",            // "online" | "stale" | "offline"
      "lastHeartbeatAt": "..."
    }
  ]
}
```

### `GET /v1/admin/tasks`
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
  ]
}
```

### `GET /v1/admin/transfers`
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
  ]
}
```

### `GET /v1/admin/audit`
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

### `GET /v1/admin/audit/verify`
Verifies the SHA-256 hash chain. Returns `{ valid: true }` if the chain is intact.
```bash
curl http://127.0.0.1:8080/v1/admin/audit/verify -H "X-Admin-Token: $ADMIN_TOKEN"
# → { "valid": true, "eventsChecked": 1234 }
```

If `valid: false`, the response includes the index of the first broken hash — investigate immediately.

### `GET /v1/admin/orgs/:org_id/snapshot`
Returns a single round-trip snapshot of all per-org data (users, devices, instances, presence, tasks, transfers, recent audit). Used by the Org Snapshot page in the portal.

## Operational Recipes

### "Is agent B still online?"
```bash
curl http://127.0.0.1:8080/v1/admin/presence \
  -H "X-Admin-Token: $ADMIN_TOKEN" \
  | jq '.presence[] | select(.agentId == "<agent-B-id>")'
```

### "What did agent A do in the last hour?"
```bash
ONE_HOUR_AGO=$(date -u -d '1 hour ago' +"%Y-%m-%dT%H:%M:%S.000Z")
curl "http://127.0.0.1:8080/v1/admin/audit?limit=200&before=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")" \
  -H "X-Admin-Token: $ADMIN_TOKEN" \
  | jq ".events[] | select(.actorAgentInstanceId == \"<agent-A-instance-id>\") | select(.createdAt > \"$ONE_HOUR_AGO\")"
```

### "Are there any stuck relay tasks?"
```bash
curl http://127.0.0.1:8080/v1/admin/tasks -H "X-Admin-Token: $ADMIN_TOKEN" \
  | jq '.tasks[] | select(.status == "pending")'
```

### "Did the audit chain get tampered with?"
```bash
curl http://127.0.0.1:8080/v1/admin/audit/verify -H "X-Admin-Token: $ADMIN_TOKEN"
```

## Security Notes

- The admin token has full read access to all org data, including message metadata. Treat it like a root credential.
- All admin queries are org-scoped (no cross-tenant reads), but there's no row-level audit of admin access — log outbound calls to the admin API in your reverse proxy.
- For multi-org deployments, the token currently grants access to the default org only. To extend, replace `requireAdmin` with a token that carries an `orgId` claim and validate it per request.
- The Admin Portal uses **session cookies** with operator identity (Argon2id + TOTP + recovery). Every portal action is attributable to a specific operator via the audit chain.

## What admin does NOT expose

- File contents (only metadata: name, size, sha256, timestamps).
- Local file paths on the agent machines.
- Private keys, password hashes, or refresh-token hashes.
- The decrypted payload of in-flight A2A messages.
- TOTP secrets, recovery codes, or session tokens of admin users (those are stored encrypted at rest; never returned in API responses).

These are deliberately kept out of scope; an admin compromise should not become a data-exfiltration vector.

## Using the Admin Portal

The recommended operator UI is the **Admin Portal** — a standalone React app served by `apps/admin-portal/` on `:3398` in dev (and prod). It accepts a session cookie (set by the login + MFA flow) and provides:

* Nine pages: Overview, Users, Devices, Agent Instances, Presence, Tasks, File Transfers, Cloud Audit Log, Org Snapshot.
* Live polling per page (5–15s).
* TanStack Table + Virtual for the long lists (transfers, audit, tasks).
* **Cloud Audit Log** page runs a client-side SHA-256 hash-chain verifier over the returned events, mirroring the server's `verifyAuditChain()`. Use it as a quick visual integrity check.
* Operator-scoped auth (Argon2id + TOTP + recovery) with HttpOnly session cookies.
* One-time first-admin bootstrap wizard.

For the dev quickstart, troubleshooting, and the full security model, see [`admin-portal.md`](./admin-portal.md).
