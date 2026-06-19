import { Pool } from "pg";
import { closeAll } from "../src/db/connection.js";

const DANGEROUS_DATABASE_NAMES = new Set(["postgres", "template0", "template1"]);

export function requirePostgresTestUrl(): string {
  const url = process.env.CONTROL_PLANE_TEST_POSTGRES_URL?.trim();
  if (!url) {
    throw new Error(
      "CONTROL_PLANE_TEST_POSTGRES_URL is required for apps/control-plane tests. " +
      "Use a disposable local Postgres database, for example postgres://oracle:amigo@127.0.0.1:5432/oracle_amigo_test."
    );
  }
  assertDisposableDatabaseUrl(url);
  return url;
}

export async function resetPostgresTestDatabase(): Promise<void> {
  await closeAll();
  const pool = new Pool({ connectionString: requirePostgresTestUrl() });
  try {
    await pool.query("DROP SCHEMA IF EXISTS public CASCADE");
    await pool.query("CREATE SCHEMA public");
    await pool.query("GRANT ALL ON SCHEMA public TO public");
  } finally {
    await pool.end();
  }
}

export function postgresTestConfig(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    CONTROL_PLANE_DATABASE_URL: requirePostgresTestUrl(),
    CONTROL_PLANE_ENV: "test",
    METRICS_ENABLED: "false",
    ...overrides
  };
}

function assertDisposableDatabaseUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("CONTROL_PLANE_TEST_POSTGRES_URL must be a valid postgres:// URL");
  }
  if (!/^postgres(?:ql)?:$/.test(parsed.protocol)) {
    throw new Error("CONTROL_PLANE_TEST_POSTGRES_URL must use postgres:// or postgresql://");
  }
  const dbName = parsed.pathname.replace(/^\//, "");
  if (!dbName || DANGEROUS_DATABASE_NAMES.has(dbName) || !/test/i.test(dbName)) {
    throw new Error("CONTROL_PLANE_TEST_POSTGRES_URL must point to a disposable database whose name includes 'test'");
  }
}
