import { afterEach, describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, resetConfigForTest } from "../src/config.js";

const requiredControlPlaneTables = [
  "schema_migrations",
  "organizations",
  "users",
  "user_credentials",
  "refresh_tokens",
  "devices",
  "device_tokens",
  "agents",
  "agent_instances",
  "contacts",
  "presence",
  "relay_tasks",
  "relay_messages",
  "file_transfers",
  "transfer_encryption_keys",
  "audit_events",
  "admin_users",
  "admin_totp_secrets",
  "admin_recovery_codes",
  "admin_sessions",
  "admin_login_attempts",
  "admin_setup_challenges",
  "admin_login_challenges"
] as const;

function loadMigrationFiles(): Array<{ id: string; sql: string }> {
  const dir = join(process.cwd(), "src", "db", "migrations");
  return readdirSync(dir)
    .filter((name) => /^\d+_.+\.sql$/i.test(name))
    .sort((a, b) => a.localeCompare(b))
    .map((filename) => ({
      id: filename.replace(/\.sql$/i, ""),
      sql: readFileSync(join(dir, filename), "utf8")
    }));
}

afterEach(() => {
  delete process.env.CONTROL_PLANE_DATABASE_URL;
  delete process.env.DATABASE_URL;
  resetConfigForTest({});
});

describe("control plane Postgres migrations", () => {
  it("ships ordered migrations for all required control-plane tables", () => {
    const migrations = loadMigrationFiles();

    expect(migrations.map((migration) => migration.id)).toEqual(["001_initial", "002_indexes", "003_relay_delivery_semantics"]);
    const sql = migrations.map((migration) => migration.sql).join("\n");
    for (const tableName of requiredControlPlaneTables) {
      expect(sql, tableName).toContain(`CREATE TABLE IF NOT EXISTS ${tableName}`);
    }
  });

  it("keeps critical tenant and status indexes", () => {
    const indexesSql = loadMigrationFiles().find((migration) => migration.id === "002_indexes")?.sql ?? "";

    for (const expected of [
      "idx_users_org_email",
      "idx_users_org_id",
      "idx_devices_org_user",
      "idx_agent_instances_org_instance",
      "idx_relay_messages_org_inbox_queued",
      "idx_relay_tasks_org_retry",
      "idx_file_transfers_org_status_created",
      "idx_audit_events_org_created"
    ]) {
      expect(indexesSql).toContain(expected);
    }

    expect(indexesSql).toContain("WHERE status = 'queued'");
    expect(indexesSql).toContain("WHERE status IN ('queued', 'delivered_to_remote_agent')");
    expect(indexesSql).toContain("WHERE status IN ('ready', 'uploading', 'downloading')");
  });

  it("defines explicit relay delivery states and retry fields", () => {
    const sql = loadMigrationFiles().map((migration) => migration.sql).join("\n");

    for (const state of [
      "accepted",
      "queued",
      "delivered_to_remote_agent",
      "stored_by_remote_agent",
      "waiting_approval",
      "approved",
      "transfer_started",
      "completed",
      "failed",
      "expired"
    ]) {
      expect(sql).toContain(state);
    }
    for (const column of ["attempt_count", "max_attempts", "last_error", "next_retry_at", "failed_at", "expires_at"]) {
      expect(sql).toContain(column);
    }
  });

  it("uses Postgres-safe migration SQL", () => {
    const initialSql = loadMigrationFiles().find((migration) => migration.id === "001_initial")?.sql ?? "";

    expect(initialSql).toContain("CREATE TABLE IF NOT EXISTS organizations");
    expect(initialSql).toContain("id BIGSERIAL PRIMARY KEY");
    expect(initialSql).not.toContain("AUTOINCREMENT");
    expect(initialSql).not.toContain("PRAGMA");
  });
});

describe("control plane database config", () => {
  it("accepts explicit Postgres URL", () => {
    resetConfigForTest({
      CONTROL_PLANE_ENV: "test",
      CONTROL_PLANE_DATABASE_URL: "postgres://oracle:amigo@db.example.test:5432/oracle_amigo_test"
    });

    expect(loadConfig().CONTROL_PLANE_DATABASE_URL).toBe("postgres://oracle:amigo@db.example.test:5432/oracle_amigo_test");
  });

  it("requires a Postgres URL", () => {
    resetConfigForTest({ CONTROL_PLANE_ENV: "test", CONTROL_PLANE_DATABASE_URL: "" });

    expect(() => loadConfig()).toThrow(/CONTROL_PLANE_DATABASE_URL or DATABASE_URL/);
  });

  it("keeps Postgres URL required for enterprise production", () => {
    resetConfigForTest({
      CONTROL_PLANE_ENV: "production",
      NODE_ENV: "production",
      CONTROL_PLANE_DEPLOYMENT_TIER: "enterprise"
    });

    expect(() => loadConfig()).toThrow(/CONTROL_PLANE_DATABASE_URL or DATABASE_URL/);
  });
});
