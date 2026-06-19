import { loadConfig, resolvedPostgresUrl } from "../config.js";
import { PostgresControlPlaneStore, type ControlPlaneStore } from "./ControlPlaneStore.js";

let _store: ControlPlaneStore | null = null;

export function getControlPlaneStore(): ControlPlaneStore {
  if (_store) return _store;

  const cfg = loadConfig();
  const connectionString = resolvedPostgresUrl(cfg);
  if (!connectionString) {
    throw new Error("CONTROL_PLANE_DATABASE_URL or DATABASE_URL is required for the Postgres control plane");
  }

  _store = new PostgresControlPlaneStore({
    connectionString,
    poolConfig: {
      max: cfg.CONTROL_PLANE_PG_POOL_MAX,
      idleTimeoutMillis: cfg.CONTROL_PLANE_PG_IDLE_TIMEOUT_MS,
      connectionTimeoutMillis: cfg.CONTROL_PLANE_PG_CONNECTION_TIMEOUT_MS
    }
  });
  return _store;
}

export async function closeAll(): Promise<void> {
  if (_store) {
    const store = _store;
    _store = null;
    await store.close();
  }
}

export async function _resetForTest(): Promise<void> {
  await closeAll();
}
