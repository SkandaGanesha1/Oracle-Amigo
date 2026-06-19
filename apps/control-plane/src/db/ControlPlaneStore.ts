import { Pool as PgPool, type Pool, type PoolClient, type PoolConfig, type QueryResult } from "pg";
import { runPostgresMigrations } from "./migrations.js";

export type ControlPlaneDialect = "postgres";

export interface ControlPlaneStore {
  readonly dialect: ControlPlaneDialect;
  query<T extends object = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<T[]>;
  one<T extends object = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<T | undefined>;
  execute(sql: string, params?: readonly unknown[]): Promise<ControlPlaneExecuteResult>;
  transaction<T>(fn: (store: ControlPlaneStore) => Promise<T>): Promise<T>;
  migrate(): Promise<void>;
  healthCheck(): Promise<boolean>;
  close(): Promise<void>;
}

export interface ControlPlaneExecuteResult {
  changes: number;
}

export const requiredControlPlaneTables = [
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

type PgRunner = Pool | PoolClient;

export interface PostgresControlPlaneStoreOptions {
  connectionString?: string;
  poolConfig?: PoolConfig;
  pool?: Pool;
}

export class PostgresControlPlaneStore implements ControlPlaneStore {
  readonly dialect = "postgres" as const;
  private readonly pool: Pool;
  private readonly ownsPool: boolean;
  private readonly client?: PoolClient;

  constructor(options: PostgresControlPlaneStoreOptions | { pool: Pool; client: PoolClient }) {
    if ("client" in options) {
      this.pool = options.pool;
      this.client = options.client;
      this.ownsPool = false;
      return;
    }
    if (options.pool) {
      this.pool = options.pool;
      this.ownsPool = false;
      return;
    }
    if (!options.connectionString && !options.poolConfig?.connectionString) {
      throw new Error("PostgresControlPlaneStore requires CONTROL_PLANE_DATABASE_URL or DATABASE_URL");
    }
    this.pool = new PgPool({
      connectionString: options.connectionString,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      ...options.poolConfig
    });
    this.ownsPool = true;
  }

  private runner(): PgRunner {
    return this.client ?? this.pool;
  }

  async query<T extends object = Record<string, unknown>>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
    assertPostgresSql(sql);
    const result: QueryResult<T> = await this.runner().query(sql, [...params]);
    return result.rows;
  }

  async one<T extends object = Record<string, unknown>>(sql: string, params: readonly unknown[] = []): Promise<T | undefined> {
    const rows = await this.query<T>(sql, params);
    return rows[0];
  }

  async execute(sql: string, params: readonly unknown[] = []): Promise<ControlPlaneExecuteResult> {
    assertPostgresSql(sql);
    const result = await this.runner().query(sql, [...params]);
    return { changes: result.rowCount ?? 0 };
  }

  async transaction<T>(fn: (store: ControlPlaneStore) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const txStore = new PostgresControlPlaneStore({ pool: this.pool, client });
      const output = await fn(txStore);
      await client.query("COMMIT");
      return output;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async migrate(): Promise<void> {
    await runPostgresMigrations(this.pool);
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.pool.query("SELECT 1");
      return true;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    if (this.ownsPool) await this.pool.end();
  }
}

function assertPostgresSql(sql: string): void {
  if (sql.includes("?")) {
    throw new Error("Postgres control-plane SQL must use $n placeholders, not '?' placeholders");
  }
}
