# Admin Monitoring

The Admin Portal monitors and revokes control-plane resources. It is separate from normal user auth and does not expose file bytes or local file paths.

## Auth

Admin auth supports:

- password hashed with Argon2id
- TOTP with encrypted secrets
- hashed recovery codes
- HttpOnly session cookies
- static dev/bootstrap token only when explicitly configured

Normal user access tokens are rejected by admin APIs.

## Pages

- Dashboard overview
- Users
- Devices
- Agent Instances
- Presence
- A2A Relay Tasks
- File Transfers
- Approvals
- Audit Events
- Security / Revocation

## APIs

Read APIs:

- `GET /v1/admin/info`
- `GET /v1/admin/users`
- `GET /v1/admin/devices`
- `GET /v1/admin/agent-instances`
- `GET /v1/admin/presence`
- `GET /v1/admin/tasks`
- `GET /v1/admin/transfers`
- `GET /v1/admin/approvals`
- `GET /v1/admin/audit`
- `GET /v1/admin/orgs/:org_id/snapshot`

Revocation APIs:

- `POST /v1/admin/devices/:device_id/revoke`
- `POST /v1/admin/users/:user_id/disable`
- `POST /v1/admin/agent-instances/:agent_instance_id/disable`

## Security Behavior

- Device revoke sets the device to `revoked`, revokes active device tokens, revokes associated agent instances, and marks presence revoked.
- User disable revokes refresh tokens and device tokens, disables active devices/agents/agent instances, and marks presence revoked.
- Agent-instance disable blocks relay polling and heartbeat because device-auth routes validate the agent-instance status.
- Admin transfer views omit cloud `storage_path`.
- Admin views do not include local file paths.

## Verification

```bash
npm --prefix apps/control-plane test
npm --prefix apps/admin-portal run typecheck
npm --prefix apps/admin-portal run build
```

Focused hardening coverage is in `apps/control-plane/tests/admin-hardening.test.ts`.
