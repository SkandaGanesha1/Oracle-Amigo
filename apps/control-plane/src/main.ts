import "dotenv/config";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import fastifyMetrics from "fastify-metrics";
import { loadConfig } from "./config.js";
import { getControlPlaneStore } from "./db/connection.js";
import { ensureDefaultOrganization } from "./db/migrations.js";
import { registerAuthRoutes } from "./auth/AuthRoutes.js";
import { registerEnrollmentRoutes } from "./enrollment/EnrollmentRoutes.js";
import { registerDirectoryRoutes } from "./directory/DirectoryRoutes.js";
import { registerContactsRoutes } from "./contacts/ContactsRoutes.js";
import { registerPresenceRoutes } from "./presence/PresenceRoutes.js";
import { registerA2ARelayRoutes } from "./relay/A2ARelayRoutes.js";
import { expireRelayTasks } from "./relay/A2ARelayService.js";
import { registerTransferRoutes } from "./transfers/TransferRoutes.js";
import { registerAdminRoutes } from "./admin/AdminRoutes.js";
import { registerAdminAuthRoutes } from "./admin/AdminAuthRoutes.js";
import { expireOldTransfers } from "./transfers/TransferService.js";
import { recomputeStalePresence } from "./presence/PresenceService.js";

export interface BuildAppOptions {
  configOverrides?: Record<string, string>;
}

export async function buildApp(opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  if (opts.configOverrides) {
    for (const [k, v] of Object.entries(opts.configOverrides)) {
      process.env[k] = v;
    }
  }
  const cfg = loadConfig();
  const store = getControlPlaneStore();
  await store.migrate();
  await ensureDefaultOrganization(store, cfg.DEFAULT_ORG_SLUG, "Default Organization");

  const app = Fastify({ logger: cfg.CONTROL_PLANE_ENV === "production" });
  // Startup banner (visible in dev where Fastify's pino logger is off).
  // eslint-disable-next-line no-console
  console.log(
    `[control-plane] env=${cfg.CONTROL_PLANE_ENV} db=postgres ` +
    `admin_cookie=${cfg.ADMIN_COOKIE_HOST_PREFIX === "true" ? "__Host-admin_session" : "admin_session"}`,
  );
  // Cookie parsing is required for the admin portal session cookie. No `secret` — the cookie
  // value is an opaque random token whose hash is stored in admin_sessions.token_hash.
  await app.register(cookie, {});
  // Allow raw octet-stream uploads for file transfer PUT
  app.addContentTypeParser("application/octet-stream", { parseAs: "buffer" }, (_req, body, done) => {
    done(null, body);
  });
  app.setErrorHandler((err: Error, req, reply) => {
    app.log.error({ err, url: req.url, method: req.method }, "request failed");
    reply.code(500).send({ error: "INTERNAL_ERROR", message: err.message });
  });

  // Prometheus metrics (unless explicitly disabled)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let metricsGauges: Record<string, any> | null = null;

  if (cfg.METRICS_ENABLED === "true") {
    await app.register(fastifyMetrics as never, {
      endpoint: cfg.METRICS_ENDPOINT,
      defaultMetrics: { enabled: true },
      routeMetrics: { enabled: true }
    });

    const client = app.metrics.client;
    const gaugeOpts = { registers: [client.register] };

    const usersGauge = new client.Gauge({
      name: "control_plane_users_total",
      help: "Total users by status",
      labelNames: ["status"],
      ...gaugeOpts
    });
    const devicesGauge = new client.Gauge({
      name: "control_plane_devices_total",
      help: "Total devices by status",
      labelNames: ["status"],
      ...gaugeOpts
    });
    const presenceOnlineGauge = new client.Gauge({
      name: "control_plane_presence_online",
      help: "Number of online devices (heartbeat within stale threshold)",
      ...gaugeOpts
    });
    const sessionsActiveGauge = new client.Gauge({
      name: "control_plane_sessions_active",
      help: "Number of active admin sessions",
      ...gaugeOpts
    });
    const relayTasksTotal = new client.Gauge({
      name: "control_plane_relay_tasks_total",
      help: "Total relay tasks by status and type",
      labelNames: ["status", "type"],
      ...gaugeOpts
    });
    const relayQueueDepth = new client.Gauge({
      name: "control_plane_relay_queue_depth",
      help: "Retry-eligible relay tasks waiting for receiver delivery",
      labelNames: ["status"],
      ...gaugeOpts
    });
    const relayDeliveryLatency = new client.Gauge({
      name: "control_plane_relay_delivery_latency_seconds",
      help: "Average relay delivery latency from queued_at to stored/completed/final state",
      labelNames: ["status"],
      ...gaugeOpts
    });
    const relayFailedCount = new client.Gauge({
      name: "control_plane_relay_failed_count",
      help: "Total relay tasks failed or expired",
      labelNames: ["status"],
      ...gaugeOpts
    });
    const relayRetryCount = new client.Gauge({
      name: "control_plane_relay_retry_count",
      help: "Total relay delivery retry attempts beyond first delivery",
      labelNames: ["status"],
      ...gaugeOpts
    });
    const fileTransfersTotal = new client.Gauge({
      name: "control_plane_file_transfers_total",
      help: "Total file transfers by status",
      labelNames: ["status"],
      ...gaugeOpts
    });
    const adminLoginsTotal = new client.Gauge({
      name: "control_plane_admin_logins_total",
      help: "Total admin login attempts by result",
      labelNames: ["result"],
      ...gaugeOpts
    });
    const auditEventsTotal = new client.Gauge({
      name: "control_plane_audit_events_total",
      help: "Total audit events by type",
      labelNames: ["event_type"],
      ...gaugeOpts
    });

    metricsGauges = {
      usersGauge, devicesGauge, presenceOnlineGauge,
      sessionsActiveGauge,
      relayTasksTotal, relayQueueDepth, relayDeliveryLatency, relayFailedCount, relayRetryCount, fileTransfersTotal,
      adminLoginsTotal, auditEventsTotal
    };

    const collectDbGauges = async () => {
      try {
        const db = getControlPlaneStore();
        const usersByStatus = await db.query<{ status: string; cnt: string | number }>(
          "SELECT status, COUNT(*) AS cnt FROM users GROUP BY status"
        );
        for (const row of usersByStatus) {
          usersGauge.set({ status: row.status }, Number(row.cnt));
        }
        const devicesByStatus = await db.query<{ status: string; cnt: string | number }>(
          "SELECT status, COUNT(*) AS cnt FROM devices GROUP BY status"
        );
        for (const row of devicesByStatus) {
          devicesGauge.set({ status: row.status }, Number(row.cnt));
        }
        const onlineCount = await db.one<{ cnt: string | number }>(
          "SELECT COUNT(*) AS cnt FROM presence WHERE status = 'online'"
        );
        presenceOnlineGauge.set(Number(onlineCount?.cnt ?? 0));
        const sessionCount = await db.one<{ cnt: string | number }>(
          "SELECT COUNT(*) AS cnt FROM admin_sessions WHERE expires_at > now() AND revoked_at IS NULL"
        );
        sessionsActiveGauge.set(Number(sessionCount?.cnt ?? 0));
        const tasksByStatus = await db.query<{ status: string; type: string; cnt: string | number }>(
          "SELECT status, type, COUNT(*) AS cnt FROM relay_tasks GROUP BY status, type"
        );
        for (const row of tasksByStatus) {
          relayTasksTotal.set({ status: row.status, type: row.type ?? "unknown" }, Number(row.cnt));
        }
        const queueDepthRows = await db.query<{ status: string; cnt: string | number }>(`
          SELECT status, COUNT(*) AS cnt
          FROM relay_tasks
          WHERE status IN ('queued', 'delivered_to_remote_agent')
            AND (expires_at IS NULL OR expires_at > now())
            AND (next_retry_at IS NULL OR next_retry_at <= now())
            AND attempt_count < max_attempts
          GROUP BY status
        `);
        for (const row of queueDepthRows) {
          relayQueueDepth.set({ status: row.status }, Number(row.cnt));
        }
        const latencyRows = await db.query<{ status: string; seconds: string | number | null }>(`
          SELECT status, AVG(EXTRACT(EPOCH FROM (COALESCE(stored_at, completed_at, failed_at, expired_at, updated_at) - queued_at))) AS seconds
          FROM relay_tasks
          WHERE queued_at IS NOT NULL
            AND status IN ('stored_by_remote_agent', 'waiting_approval', 'approved', 'transfer_started', 'completed', 'failed', 'expired')
          GROUP BY status
        `);
        for (const row of latencyRows) {
          relayDeliveryLatency.set({ status: row.status }, Number(row.seconds ?? 0));
        }
        const failedRows = await db.query<{ status: string; cnt: string | number }>(`
          SELECT status, COUNT(*) AS cnt
          FROM relay_tasks
          WHERE status IN ('failed', 'expired')
          GROUP BY status
        `);
        for (const row of failedRows) {
          relayFailedCount.set({ status: row.status }, Number(row.cnt));
        }
        const retryRows = await db.query<{ status: string; retries: string | number }>(`
          SELECT status, COALESCE(SUM(GREATEST(attempt_count - 1, 0)), 0) AS retries
          FROM relay_tasks
          GROUP BY status
        `);
        for (const row of retryRows) {
          relayRetryCount.set({ status: row.status }, Number(row.retries));
        }
        const transfersByStatus = await db.query<{ status: string; cnt: string | number }>(
          "SELECT status, COUNT(*) AS cnt FROM file_transfers GROUP BY status"
        );
        for (const row of transfersByStatus) {
          fileTransfersTotal.set({ status: row.status }, Number(row.cnt));
        }
        const auditEventsByType = await db.query<{ event_type: string; cnt: string | number }>(
          "SELECT event_type, COUNT(*) AS cnt FROM audit_events GROUP BY event_type"
        );
        for (const row of auditEventsByType) {
          auditEventsTotal.set({ event_type: row.event_type }, Number(row.cnt));
        }
      } catch { /* swallow errors during gauge collection */ }
    };
    // Collect on startup and every 60s
    void collectDbGauges();
    setInterval(() => { void collectDbGauges(); }, 60_000);
  }

  app.get("/health", async () => ({
    status: "ok",
    service: "oracle-amigo-control-plane",
    version: "0.1.0",
    env: cfg.CONTROL_PLANE_ENV,
    public_url: cfg.CONTROL_PLANE_PUBLIC_URL
  }));

  app.get("/livez", async () => ({
    status: "ok",
    service: "oracle-amigo-control-plane"
  }));

  app.get("/ready", async (_req, reply) => {
    try {
      if (!(await store.healthCheck())) {
        throw new Error("database health check failed");
      }
      return {
        status: "ready",
        service: "oracle-amigo-control-plane"
      };
    } catch (err) {
      app.log.error({ err }, "control plane readiness check failed");
      return reply.code(503).send({
        status: "not_ready",
        service: "oracle-amigo-control-plane"
      });
    }
  });

  await registerAuthRoutes(app);
  await registerEnrollmentRoutes(app, cfg.CONTROL_PLANE_PUBLIC_URL);
  await registerDirectoryRoutes(app);
  await registerContactsRoutes(app);
  await registerPresenceRoutes(app);
  await registerA2ARelayRoutes(app);
  await registerTransferRoutes(app, cfg.CONTROL_PLANE_PUBLIC_URL);
  await registerAdminRoutes(app);
  await registerAdminAuthRoutes(app);

  return app;
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  const app = await buildApp();
  mkdirSync(dirname(cfg.FILE_TRANSFER_STORE), { recursive: true });
  // Background cleanup: every 60s
  setInterval(() => {
    void recomputeStalePresence().catch(() => undefined);
    void expireOldTransfers().catch(() => undefined);
    void expireRelayTasks().catch(() => undefined);
  }, 60_000);
  await app.listen({ port: cfg.CONTROL_PLANE_PORT, host: cfg.CONTROL_PLANE_HOST });
  // eslint-disable-next-line no-console
  console.log(`[control-plane] listening at http://${cfg.CONTROL_PLANE_HOST}:${cfg.CONTROL_PLANE_PORT}`);
  // eslint-disable-next-line no-console
  console.log(`[control-plane] admin portal endpoints: GET  /v1/admin/auth/setup-status, POST /v1/admin/auth/setup/start, POST /v1/admin/auth/setup, POST /v1/admin/auth/login, POST /v1/admin/auth/mfa/verify, POST /v1/admin/auth/mfa/recovery, GET  /v1/admin/auth/me, POST /v1/admin/auth/logout`);
}

// Detect whether this file is the entry point. Under tsx on Windows, `import.meta.url`
// (file:///C:/.../main.ts) and `process.argv[1]` (C:\...\main.ts) don't match after
// the to-file-URL conversion, so the previous `isEntry` check failed and `main()` was
// never called. Use a more permissive check that works for `tsx`, `tsx watch`, and
// compiled `node dist/main.js` invocations.
const argv1 = (process.argv[1] ?? "").replace(/\\/g, "/");
const entryHref = new URL(import.meta.url).href.replace(/\\/g, "/");
const isEntry =
  argv1.endsWith("/main.ts") ||
  argv1.endsWith("/main.js") ||
  argv1.endsWith("/main.mjs") ||
  argv1.endsWith("/main.cjs") ||
  entryHref === argv1 ||
  entryHref === `file:///${argv1}` ||
  entryHref === `file://${argv1.startsWith("/") ? argv1 : "/" + argv1}`;
if (isEntry) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error("Failed to start control plane:", err);
    process.exit(1);
  });
}
