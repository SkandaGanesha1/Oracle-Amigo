# Two-Laptop Deployment Guide

This guide walks through running Oracle Amigo's full stack on two separate machines (or, for development, two separate processes on the same machine) to demonstrate cross-device A2A v1.0.0 + ANP handshake.

## Topology

```
┌──────────────────────────┐         ┌──────────────────────────┐
│ LAPTOP A                 │         │ LAPTOP B                 │
│ ┌──────────────────────┐ │         │ ┌──────────────────────┐ │
│ │ Local Agent A        │ │         │ │ Local Agent B        │ │
│ │ port 3399            │ │         │ │ port 3400            │ │
│ │ ed25519 key A        │ │         │ │ ed25519 key B        │ │
│ └─────────┬────────────┘ │         │ └─────────┬────────────┘ │
│           │ ANP          │         │           │ ANP          │
│           │ /A2A v1.0.0  │◄───────►│           │ /A2A v1.0.0  │
│           │              │         │           │              │
└───────────┼──────────────┘         └───────────┼──────────────┘
            │                                    │
            └─────────►┌──────────────────┐◄──────┘
                      │ Control Plane    │
                      │ port 8080        │
                      │ SQLite DB        │
                      │ Tenant: demo-org │
                      └──────────────────┘
```

For development, all three can run on one machine with different ports.

## Prerequisites

- Node.js 20+ (LTS) on each laptop
- (Optional) `sqlite-vec` available; the local agent uses FTS5 by default and vec0 for embeddings
- (Optional) `OCI_GENAI_API_KEY` env var on each laptop for real embeddings (FNV-1a stub is the fallback)

## Step 1: Start the Control Plane (Laptop A or shared host)

```bash
cd Oracle_Amigo
npm install
npm run build:control-plane
JWT_ACCESS_SECRET="$(openssl rand -hex 32)" \
JWT_REFRESH_SECRET="$(openssl rand -hex 32)" \
DEV_ADMIN_TOKEN="$(openssl rand -hex 16)" \
DEFAULT_ORG_SLUG=demo-org \
  node apps/control-plane/dist/main.js
```

The control plane prints a startup banner including the listen URL. Confirm `/health` returns 200:
```bash
curl http://127.0.0.1:8080/health
```

## Step 2: Start Local Agent A (Laptop A)

```bash
cd Oracle_Amigo
AGENTIC_PORT=3399 \
AGENTIC_CONTROL_PLANE_URL=http://<control-plane-host>:8080 \
AGENTIC_TENANT=demo-org \
  npm start
```

The agent:
1. Generates a per-install ed25519 keypair under `%LOCALAPPDATA%\AgenticApp\keys\` (or `~/.agentic-app/keys/` on macOS/Linux).
2. Creates a profile in the local SQLite DB.
3. Enrolls with the control plane (sign-up + device enrollment + agent-instance activation).
4. Starts broadcasting presence heartbeats every 30 seconds.

## Step 3: Start Local Agent B (Laptop B or same machine)

```bash
cd Oracle_Amigo
AGENTIC_PORT=3400 \
AGENTIC_CONTROL_PLANE_URL=http://<control-plane-host>:8080 \
AGENTIC_TENANT=demo-org \
  npm start
```

The second agent enrolls under the same `demo-org` (the control plane derives the org from the API call). For the first run with a fresh control-plane DB, the first agent's enrollment is auto-attached to the default org.

## Step 4: Verify Discovery

On Laptop A:
```bash
curl http://127.0.0.1:8080/contacts \
  -H "Authorization: Bearer <agent-A-access-token>"
# Initially empty — the agents haven't friended each other yet.
```

## Step 5: Friend the Agents

From Agent A's UI or via the API:
```bash
# Agent A invites Agent B
curl -X POST http://127.0.0.1:3399/cloud/contacts/requests \
  -H "Content-Type: application/json" \
  -d '{"targetAgentId": "<agent-B-id>"}'

# Agent B accepts
curl -X POST http://127.0.0.1:3400/cloud/contacts/accept \
  -H "Content-Type: application/json" \
  -d '{"requesterAgentId": "<agent-A-id>"}'
```

(Replace `<agent-A-id>` and `<agent-B-id>` with the values from each agent's `GET /profile` response.)

## Step 6: A2A v1.0.0 Cross-Device Handshake

Once friended, the two agents can speak A2A v1.0.0 directly. From Agent A:
```bash
curl -X POST http://127.0.0.1:3399/v1/message:send \
  -H "Content-Type: application/a2a+json" \
  -H "A2A-Version: 1.0" \
  -d '{
    "message": {
      "messageId": "00000000-0000-0000-0000-000000000001",
      "role": "ROLE_USER",
      "parts": [{"kind": "text", "text": "Find my latest report"}]
    }
  }'
```

The local agent looks up Agent B's public card at `http://<laptop-B>:3400/.well-known/agent-card.json`, performs the ANP handshake (offer → response → DID resolution → replay protection), and dispatches the task to Agent B's `/v1/message:send` endpoint.

Agent B's response flows back through the same encrypted channel and is returned to the caller.

## Step 7: File Transfer Across Devices

```bash
# Agent A uploads a file to the cloud
curl -X POST http://127.0.0.1:3399/agent/file-transfer/init \
  -H "Content-Type: application/json" \
  -d '{
    "fileName": "report.pdf",
    "size": 102400,
    "sha256": "<sha256-hash>",
    "recipientAgentId": "<agent-B-id>"
  }'
# → returns { transferId, uploadUrl }

# Upload the ciphertext (OAT1 format, encrypted locally)
curl -X PUT <uploadUrl> --data-binary @encrypted.bin

# Notify Agent B
curl -X POST http://127.0.0.1:3399/agent/file-transfer/notify \
  -d '{"transferId": "<id>", "to": "<agent-B-id>"}'
```

Agent B's local agent picks up the notification from its inbox poll, downloads the ciphertext via the control plane, decrypts with the per-transfer key, and verifies the SHA-256.

## Step 8: A2A v1 Streaming Across Devices

```bash
curl -N -X POST http://127.0.0.1:3399/v1/message:stream \
  -H "Content-Type: application/a2a+json" \
  -H "A2A-Version: 1.0" \
  -d '{
    "message": {
      "messageId": "00000000-0000-0000-0000-000000000002",
      "role": "ROLE_USER",
      "parts": [{"kind": "text", "text": "Stream me a long analysis"}]
    }
  }'
```

SSE frames stream back as the task progresses through its state machine.

## Step 9: Admin Monitoring

From a third terminal (or any host that can reach the control plane):
```bash
ADMIN_TOKEN=<your-DEV_ADMIN_TOKEN> \
  curl http://127.0.0.1:8080/admin/devices \
    -H "X-Admin-Token: $ADMIN_TOKEN"
# → { devices: [...], total: N }
```

Other admin endpoints: `/admin/users`, `/admin/agent-instances`, `/admin/presence`, `/admin/tasks`, `/admin/transfers`, `/admin/audit`.

## Common Pitfalls

- **Agents can't see each other**: confirm both are enrolled under the same `org_id` (`/admin/users` should show both users).
- **ANP handshake fails**: check `loglevel` output on both agents. The most common cause is the v1 card's `publicKey` not matching the locally-stored one (re-enroll the device).
- **File transfer upload 413**: the file exceeds `TRANSFER_MAX_FILE_SIZE_BYTES` (default 100 MB).
- **A2A v1 routes 404**: confirm the request includes `Content-Type: application/a2a+json` and the colon-verb path is exactly as documented.

## Next: productionizing

This demo uses loopback connections and `DEV_ADMIN_TOKEN` for admin. Production should add:
- TLS termination on the control plane (nginx/Caddy).
- JWT secret rotation strategy.
- A real OCI GenAI integration for embeddings.
- Persistent process supervision (systemd, launchd, or Windows Service).
- Network policy: only expose the control plane to the local network segment; the agents should reach it via a private route.
