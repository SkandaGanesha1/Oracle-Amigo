# Two-Laptop Relay-First Deployment

Oracle Amigo cross-device traffic should go through the control plane relay. Do not configure laptop A to call laptop B's local agent URL directly for product file-request flows.

## Requirements

- Node.js `>=24` on every machine.
- Same repo revision on the control-plane host and both laptops.
- Network reachability from each laptop to `CONTROL_PLANE_URL`.

## Local Relay E2E

Run the current relay-first harness on one development machine:

```bash
npm run test:e2e:relay
```

Expected output:

```text
PASS two-agent relay file request
```

The script starts:

- control plane on a temporary localhost port
- Agent A on `127.0.0.1:3399` with profile `alice`
- Agent B on `127.0.0.1:3400` with profile `bob`

It signs up both users, enrolls both devices, heartbeats, verifies admin presence, searches directory, sends a relay file request, creates Bob's approval, approves it, transfers through the control-plane transfer API, verifies SHA-256, and checks admin task/transfer/audit visibility.

## Control Plane

```bash
npm install
npm run build:control-plane

CONTROL_PLANE_HOST=0.0.0.0 \
CONTROL_PLANE_PORT=8080 \
CONTROL_PLANE_PUBLIC_URL=http://<control-plane-host>:8080 \
CONTROL_PLANE_DB_PATH=./data/control-plane.db \
JWT_ACCESS_SECRET=<strong-secret> \
JWT_REFRESH_SECRET=<strong-secret> \
ADMIN_KEK=<32-plus-char-secret> \
ADMIN_COOKIE_HOST_PREFIX=false \
npm run start:control-plane
```

For production set TLS, `CONTROL_PLANE_ENV=production`, `ADMIN_COOKIE_HOST_PREFIX=true`, changed JWT secrets, changed `ADMIN_KEK`, and no `ADMIN_BOOTSTRAP_TOKEN`.

## Laptop A

```bash
CONTROL_PLANE_URL=http://<control-plane-host>:8080 \
AGENTIC_PROFILE_ID=alice \
AGENTIC_DB_PATH=./data/alice/oracle-amigo.db \
AGENTIC_STORAGE_ROOT=./data/alice/storage \
SANDBOX_PORT=3399 \
AGENTIC_AGENT_PORT=3399 \
AGENTIC_RELAY_MODE=polling \
AGENTIC_HEARTBEAT_INTERVAL_SECONDS=15 \
AGENTIC_RELAY_POLL_INTERVAL_SECONDS=3 \
npm run dev
```

Open `http://127.0.0.1:3399/`, sign up or log in, and enroll the device.

## Laptop B

```bash
CONTROL_PLANE_URL=http://<control-plane-host>:8080 \
AGENTIC_PROFILE_ID=bob \
AGENTIC_DB_PATH=./data/bob/oracle-amigo.db \
AGENTIC_STORAGE_ROOT=./data/bob/storage \
SANDBOX_PORT=3400 \
AGENTIC_AGENT_PORT=3400 \
AGENTIC_RELAY_MODE=polling \
AGENTIC_HEARTBEAT_INTERVAL_SECONDS=15 \
AGENTIC_RELAY_POLL_INTERVAL_SECONDS=3 \
npm run dev
```

Open `http://127.0.0.1:3400/`, sign up or log in under the same org, and enroll.

## Admin Portal

```bash
npm run build:admin-portal
npm run dev:admin-portal
```

Use the portal to inspect users, devices, agent instances, presence, tasks, transfers, approvals, audit events, and security/revocation.

## Notification Bridge

On Windows:

```bash
npm run dev:notification-bridge
```

The local agent callback endpoint is `/approvals/notification-callback`. Callbacks are DB-idempotent; duplicate approve/reject cannot create duplicate transfers.

## Troubleshooting

- Directory search does not find the other user: confirm both users are in the same org and both devices are enrolled.
- Heartbeat fails after revocation: expected. Admin device revoke revokes device tokens and associated agent instances.
- Relay inbox remains empty: check `GET /cloud/status` and `GET /relay/inbox/status` on the receiver.
- File requests create approvals; approval now triggers cloud transfer upload, receiver download, SHA-256 verification, local storage, receipt, and admin transfer completion through the local runtimes.
- A2A payload examples must not include `kind` for v1 protocol objects.
