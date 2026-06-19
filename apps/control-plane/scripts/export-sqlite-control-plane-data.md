# Export Legacy SQLite Control-Plane Data

This is a one-time migration aid for old pilot databases. Do not add SQLite runtime packages back to `apps/control-plane`.

## Export With External sqlite3

Freeze writes, then export each table in dependency order:

```powershell
$db = ".\data\control-plane.db"
$out = ".\exports\control-plane"
New-Item -ItemType Directory -Force $out
sqlite3 $db ".mode json" ".once $out\organizations.json" "SELECT * FROM organizations;"
```

Repeat for:

1. `organizations`
2. `users`, `user_credentials`
3. `refresh_tokens`
4. `devices`, `device_tokens`
5. `agents`, `agent_instances`
6. `contacts`, `presence`
7. `relay_tasks`, `relay_messages`
8. `file_transfers`, `transfer_encryption_keys`
9. `audit_events`
10. `admin_users`, `admin_totp_secrets`, `admin_recovery_codes`, `admin_sessions`, `admin_login_attempts`, `admin_setup_challenges`, `admin_login_challenges`

## Import Requirements

- Run Postgres migrations first.
- Import with parameterized SQL through `pg` or `ControlPlaneStore`.
- Preserve source IDs exactly.
- Import table groups inside explicit transactions.
- Validate row counts, tenant counts, active relay and transfer states, and audit hash chains before cutover.
