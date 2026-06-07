# Two-Laptop Demo Checklist

Use this checklist when demonstrating Oracle Amigo's cross-device capabilities. Works for both single-machine (`scripts/demo-two-laptop.sh` or `scripts/demo-two-laptop.ps1`) and true two-laptop setups.

## Pre-Demo (5 min)

- [ ] Clone the repo on both machines (or use the single-machine launcher)
- [ ] `npm install` on each
- [ ] Generate a fresh pair of JWT secrets (the script does this for you)
- [ ] Confirm port 8080 (control plane), 3399 (agent A), 3400 (agent B) are free
- [ ] (Optional) `OCI_GENAI_API_KEY` in `.env` for real embeddings; otherwise FNV-1a stub is fine
- [ ] Run `npm run build:control-plane` once on the control plane host

## Demo Run (15-20 min)

### Step 1: Start the control plane
- [ ] Run `node apps/control-plane/dist/main.js` (or `scripts/demo-two-laptop.ps1`)
- [ ] Hit `http://localhost:8080/health` → `{"status":"ok"}`
- [ ] Verify with admin: `curl -H "X-Admin-Token: $DEV_ADMIN_TOKEN" http://localhost:8080/admin/users`

### Step 2: Start both agents
- [ ] Agent A: `AGENTIC_PORT=3399 npm start`
- [ ] Agent B: `AGENTIC_PORT=3400 npm start`
- [ ] Check both come up: `curl http://localhost:3399/health` and same for 3400

### Step 3: Show the A2A v1.0.0 agent cards
- [ ] `curl http://localhost:3399/.well-known/agent-card.json | jq .`
- [ ] Point out: `protocolVersion: "1.0"`, `preferredTransport: "HTTP+JSON"`, `supportedInterfaces[0].protocolBinding: "HTTP+JSON"`
- [ ] Show the same for agent B (different `name`)

### Step 4: Sign up + enroll via the cloud clients
- [ ] Run a one-off script that uses the `src/cloud/*` clients to sign up + enroll both agents
- [ ] Show the cloud admin endpoint now lists 2 users: `curl ... /admin/users`

### Step 5: Friend the agents
- [ ] Agent A invites Agent B (POST `/cloud/contacts/requests` with `targetAgentId`)
- [ ] Agent B accepts (POST `/cloud/contacts/accept` with `requesterAgentId`)
- [ ] Show contacts list on both sides

### Step 6: A2A v1 message:send (cross-device)
- [ ] From agent A: `curl -X POST http://localhost:3399/v1/message:send -H "Content-Type: application/a2a+json" -H "A2A-Version: 1.0" -d '{...}'`
- [ ] Show the request being routed through the control plane relay
- [ ] Show agent B's task list growing (`/admin/tasks`)
- [ ] Show the response returned to agent A (with v1 task state)

### Step 7: A2A v1 streaming
- [ ] From agent A: `curl -N -X POST http://localhost:3399/v1/message:stream -H "Content-Type: application/a2a+json" -H "A2A-Version: 1.0" -d '{...}'`
- [ ] Show the SSE frames streaming in real time
- [ ] Point out the `statusUpdate` events with `final: true` when the task completes

### Step 8: File transfer (cross-device)
- [ ] Agent A: `POST /agent/file-transfer/init` with `recipientAgentId`, `fileName`, `size`, `sha256`
- [ ] Agent A: `PUT /agent/file-transfer/upload` with the encrypted blob (OAT1 format)
- [ ] Agent A: `POST /agent/file-transfer/notify` to alert agent B
- [ ] Agent B downloads via the control plane relay
- [ ] Agent B: `POST /agent/file-transfer/receipt` to confirm SHA-256 match
- [ ] Show the transfer in the admin: `curl ... /admin/transfers`

### Step 9: ANP handshake verification (security focus)
- [ ] Show the ANP offer/response flow: `/anp/handshake/offer`, `/anp/handshake/response`
- [ ] Show the hardened verifier: `/anp/handshake/verify-offer`, `/anp/handshake/verify-response`
- [ ] Demonstrate replay protection: re-submit the same offer → second call returns `false`
- [ ] Demonstrate expiry: `AGENTIC_ANP_TTL=0` (or just wait) → old offers rejected

### Step 10: Audit chain integrity
- [ ] `curl -H "X-Admin-Token: ..." http://localhost:8080/admin/audit/verify`
- [ ] Should return `{"valid": true, "eventsChecked": N}`
- [ ] Show a sample audit event from `curl ... /admin/audit?limit=5`

## Demo Wrap-up (5 min)

- [ ] Show the system handles a second cross-device message without any state leaks
- [ ] Kill the control plane, restart it — both agents reconnect, presence resumes
- [ ] Show that file transfers in flight when the control plane is killed are retried on reconnect
- [ ] (Optional) Show the cloud relay in flight: `curl ... /admin/tasks` to see pending/acked tasks

## Common Demo Failures & Fixes

| Symptom | Likely Cause | Fix |
| --- | --- | --- |
| Agent fails to start with `EADDRINUSE` | Port 3399/3400 is held by a zombie process | `lsof -i:3399` (or `Get-NetTCPConnection -LocalPort 3399` on Windows) and kill the process |
| "Fingerprint mismatch" on ANP verify | The agent's local key got regenerated under a different `LOCALAPPDATA` | Restart both agents with the same `LOCALAPPDATA` (or wipe and re-enroll) |
| SSE stream returns 200 but no events | The agent's task got cancelled before the first event | Send a long-running task (e.g. one that needs a tool call) |
| File transfer upload returns 413 | File exceeds `TRANSFER_MAX_FILE_SIZE_BYTES` (default 100 MB) | Set `TRANSFER_MAX_FILE_SIZE_BYTES=1073741824` and restart the control plane |
| Admin endpoint returns 401 | `DEV_ADMIN_TOKEN` env var is not set in the agent's shell | `export DEV_ADMIN_TOKEN=<value>` and restart the agent |

## Post-Demo

- [ ] Run the integration test: `ORACLE_AMIGO_RUN_E2E=1 npx vitest run tests/TwoLaptopE2E.test.ts`
- [ ] Run the full unit suite: `npx vitest run --config vitest.config.ts`
- [ ] Run the control plane tests: `cd apps/control-plane && npx vitest run --config vitest.config.ts`
- [ ] Wipe the demo secrets: `rm -rf .demo-secrets/` (the script creates this; it's `.gitignore`d but tidy up anyway)
