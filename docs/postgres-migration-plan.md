# Postgres Migration Plan

The cloud control plane is now Postgres-only. This does not change the local agent SQLite/sqlite-vec stores.

## Runtime Configuration

Every control-plane startup requires a Postgres URL:

```powershell
$env:CONTROL_PLANE_DATABASE_URL = "postgres://oracle_amigo:...@127.0.0.1:5432/oracle_amigo"
$env:CONTROL_PLANE_PG_POOL_MAX = "10"
$env:CONTROL_PLANE_PG_IDLE_TIMEOUT_MS = "30000"
$env:CONTROL_PLANE_PG_CONNECTION_TIMEOUT_MS = "5000"
```

`DATABASE_URL` is accepted as a fallback. There is no `CONTROL_PLANE_DB_DRIVER`, no `CONTROL_PLANE_DB_PATH`, and no `better-sqlite3` runtime dependency in `apps/control-plane`.

## Local Dev And Tests

Use a disposable local Postgres database for tests. The database name must include `test` because the test harness drops and recreates the `public` schema.

```powershell
docker run --name oracle-amigo-postgres -e POSTGRES_USER=oracle -e POSTGRES_PASSWORD=amigo -e POSTGRES_DB=oracle_amigo_test -p 5432:5432 postgres:16
$env:CONTROL_PLANE_TEST_POSTGRES_URL = "postgres://oracle:amigo@127.0.0.1:5432/oracle_amigo_test"
npm --prefix apps/control-plane test
```

For Podman, use the same image and environment variables with `podman run`.

## Migration Workflow

For legacy pilot data, use an external `sqlite3` CLI export and import into Postgres through the Postgres migration/store path. Do not add SQLite packages back to `apps/control-plane`.

1. Freeze writes to the old SQLite pilot service.
2. Back up the SQLite file and transfer object directory.
3. Run ordered Postgres migrations against the target database.
4. Export tables from SQLite in dependency order as JSON or NDJSON.
5. Import rows into Postgres using parameterized statements.
6. Validate row counts, tenant counts, active sessions, device tokens, relay queues, transfer metadata, and audit hash chains.
7. Start the Postgres-only control plane with `CONTROL_PLANE_DATABASE_URL`.
8. Smoke test auth, enrollment, directory, presence, relay, transfers, admin views, and `/ready`.

## Data Order

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

Preserve IDs exactly. Do not regenerate tenant, user, device, agent, relay, transfer, or admin IDs.

## Validation

- Required tables and indexes exist.
- Every tenant table has `org_id IS NOT NULL`.
- Directory, relay, transfer, auth refresh, and device token queries include tenant checks.
- Admin transfer responses omit `storage_path`, local paths, `file://`, bearer tokens, raw secrets, and encrypted key material.
- Audit chain verification succeeds per org.
- No admin scan endpoint returns an unbounded result set.

## Rollback

Rollback is only safe before new Postgres-only writes need to be preserved.

1. Stop the Postgres-backed control plane.
2. Restore the legacy SQLite service and transfer object store from the frozen backup.
3. Investigate and export accepted Postgres writes manually before another cutover attempt.

## Future Hardening

- Add optional Supabase deployment guidance: pooled app connection for runtime, direct connection for migrations, and provider PITR.
- Add Postgres row-level security after app-managed tenancy is stable.
- Add managed secret storage and rotation for database URLs.
- Add restore drills to release gates.
