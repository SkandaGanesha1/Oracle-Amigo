# Database Backup And Restore

This document covers cloud control-plane persistence. It does not replace local agent SQLite/sqlite-vec backup rules.

## Postgres Backup

Use `pg_dump` for logical backups and provider-native snapshots or PITR for production recovery objectives.

```powershell
pg_dump --format=custom --file=control-plane-2026-06-18.dump $env:CONTROL_PLANE_DATABASE_URL
```

Operational rules:

- Encrypt dumps before leaving the database host or managed backup boundary.
- Store database dumps with transfer-store snapshots from the same time window.
- Keep backup credentials separate from runtime credentials.
- Never log `CONTROL_PLANE_DATABASE_URL`, bearer tokens, encrypted key material, or admin session cookies.
- Retain at least one recent restore-tested backup.

## Postgres Restore

Restore into a clean database first:

```powershell
createdb oracle_amigo_restore
pg_restore --dbname=oracle_amigo_restore --clean --if-exists control-plane-2026-06-18.dump
```

Then validate:

- `schema_migrations` contains all expected migration IDs.
- Required tables and indexes exist.
- Row counts match the backup manifest.
- Tenant counts by `org_id` match.
- Relay pending counts by `(org_id, to_agent_instance_id, status)` match.
- Transfer rows with active statuses have matching transfer objects.
- Admin transfer responses omit storage internals.
- Audit hash-chain verification succeeds.

Cut over only after the restored database passes validation and the transfer object store snapshot is mounted.

## Legacy SQLite Export

Legacy pilot SQLite control-plane data is a one-time migration source only. `apps/control-plane` no longer has a SQLite runtime dependency. Use the external `sqlite3` CLI to export data and import it into Postgres with a dedicated import tool or migration script.

The old SQLite file and matching transfer object directory should remain read-only until the rollback window closes.

## Restore Drills

Run a restore drill at least once per release cycle that changes persistence. A successful drill must prove:

- A Postgres backup can restore to a new database.
- The service starts from the restored data.
- Auth, enrollment, relay, transfer, and admin read paths work.
- Transfer metadata matches the restored transfer object store.
- No local `storage_path`, `file://`, bearer token, raw secret, or encrypted key material appears in admin responses.

## Consistency Notes

File transfers span database rows and local or object-store bytes. Treat `file_transfers`, `transfer_encryption_keys`, and transfer objects as one restore unit. If the object is missing, expire or mark the transfer failed during recovery rather than exposing a dangling ready transfer.
