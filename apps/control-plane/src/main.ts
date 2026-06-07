import "dotenv/config";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { loadConfig } from "./config.js";
import { getDb } from "./db/connection.js";
import { runMigrations, ensureDefaultOrganization } from "./db/migrations.js";
import { registerAuthRoutes } from "./auth/AuthRoutes.js";
import { registerEnrollmentRoutes } from "./enrollment/EnrollmentRoutes.js";
import { registerDirectoryRoutes } from "./directory/DirectoryRoutes.js";
import { registerContactsRoutes } from "./contacts/ContactsRoutes.js";
import { registerPresenceRoutes } from "./presence/PresenceRoutes.js";
import { registerA2ARelayRoutes } from "./relay/A2ARelayRoutes.js";
import { registerTransferRoutes } from "./transfers/TransferRoutes.js";
import { registerAdminRoutes } from "./admin/AdminRoutes.js";
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
  // Ensure DB dir exists
  const db = getDb();
  runMigrations(db);
  // Ensure default org exists
  ensureDefaultOrganization(db, cfg.DEFAULT_ORG_SLUG, "Default Organization");

  const app = Fastify({ logger: cfg.CONTROL_PLANE_ENV === "production" });
  // Allow raw octet-stream uploads for file transfer PUT
  app.addContentTypeParser("application/octet-stream", { parseAs: "buffer" }, (_req, body, done) => {
    done(null, body);
  });
  app.setErrorHandler((err: Error, req, reply) => {
    app.log.error({ err, url: req.url, method: req.method }, "request failed");
    reply.code(500).send({ error: "INTERNAL_ERROR", message: err.message });
  });

  app.get("/health", async () => ({
    status: "ok",
    service: "oracle-amigo-control-plane",
    version: "0.1.0",
    env: cfg.CONTROL_PLANE_ENV,
    public_url: cfg.CONTROL_PLANE_PUBLIC_URL
  }));

  await registerAuthRoutes(app);
  await registerEnrollmentRoutes(app, cfg.CONTROL_PLANE_PUBLIC_URL);
  await registerDirectoryRoutes(app);
  await registerContactsRoutes(app);
  await registerPresenceRoutes(app);
  await registerA2ARelayRoutes(app);
  await registerTransferRoutes(app, cfg.CONTROL_PLANE_PUBLIC_URL);
  await registerAdminRoutes(app);

  return app;
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  const app = await buildApp();
  mkdirSync(dirname(cfg.FILE_TRANSFER_STORE), { recursive: true });
  // Background cleanup: every 60s
  setInterval(() => {
    try { recomputeStalePresence(); } catch { /* ignore */ }
    try { expireOldTransfers(); } catch { /* ignore */ }
  }, 60_000);
  await app.listen({ port: cfg.CONTROL_PLANE_PORT, host: cfg.CONTROL_PLANE_HOST });
  app.log.info(`Control plane listening on http://${cfg.CONTROL_PLANE_HOST}:${cfg.CONTROL_PLANE_PORT}`);
}

const isEntry = import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/")}`;
if (isEntry) {
  main().catch((err) => {
    console.error("Failed to start control plane:", err);
    process.exit(1);
  });
}
