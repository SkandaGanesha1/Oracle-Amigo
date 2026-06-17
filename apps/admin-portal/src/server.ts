import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyHttpProxy from "@fastify/http-proxy";
import fastifyMetrics from "fastify-metrics";
import { loadAdminPortalConfig } from "./config.js";

export interface BuildAppOptions {
  configOverrides?: Record<string, string>;
  staticRoot?: string;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, "..");

export async function buildApp(opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  if (opts.configOverrides) {
    for (const [k, v] of Object.entries(opts.configOverrides)) {
      process.env[k] = v;
    }
  }
  const cfg = loadAdminPortalConfig();

  const app = Fastify({ logger: cfg.ADMIN_PORTAL_LOG_LEVEL === "debug" });
  // eslint-disable-next-line no-console
  console.log(
    `[admin-portal] node_env=${process.env.NODE_ENV ?? "development"} upstream=${cfg.CONTROL_PLANE_URL} port=${cfg.ADMIN_PORTAL_PORT}`,
  );

  // Prometheus metrics (unless explicitly disabled)
  if (cfg.METRICS_ENABLED === "true") {
    await app.register(fastifyMetrics as never, {
      endpoint: cfg.METRICS_ENDPOINT,
      defaultMetrics: { enabled: true },
      routeMetrics: { enabled: true, registeredRoutesOnly: false }
    });

    const client = app.metrics.client;
    const gaugeOpts = { registers: [client.register] };

    const upstreamLatency = new client.Histogram({
      name: "admin_portal_upstream_latency_ms",
      help: "Upstream proxy request latency in milliseconds",
      labelNames: ["upstream"],
      buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 5000],
      ...gaugeOpts
    });

    const proxyErrors = new client.Counter({
      name: "admin_portal_proxy_errors_total",
      help: "Total proxy errors by upstream and status",
      labelNames: ["upstream", "status_code"],
      ...gaugeOpts
    });

    // Track upstream latency via onResponse hook
    app.addHook("onResponse", (request, reply, done) => {
      const url = request.url;
      let upstream: string | undefined;
      if (url.startsWith("/v1/")) upstream = "control-plane";
      else if (url.startsWith("/policy/")) upstream = "local-agent";
      if (upstream) {
        const elapsed = reply.elapsedTime;
        upstreamLatency.observe({ upstream }, elapsed);
        if (reply.statusCode >= 400) {
          proxyErrors.inc({ upstream, status_code: String(reply.statusCode) });
        }
      }
      done();
    });
  }

  app.get("/health", async () => ({
    status: "ok",
    service: "oracle-amigo-admin-portal",
    upstream: cfg.CONTROL_PLANE_URL
  }));

  // 1. Reverse-proxy /v1/* to the control plane. Critically: forward request `cookie` header
  // AND the upstream `set-cookie` response header so the session cookie is set/read by the
  // browser even though the origin server lives on a different port. The default
  // @fastify/http-proxy config (built on @fastify/reply-from) preserves both directions; we
  // explicitly set `changeOrigin: false` so the upstream sees our Host header rather than
  // rewriting it.
  await app.register(fastifyHttpProxy, {
    upstream: cfg.CONTROL_PLANE_URL,
    prefix: "/v1",
    rewritePrefix: "/v1"
  });

  await app.register(fastifyHttpProxy, {
    upstream: cfg.LOCAL_AGENT_URL,
    prefix: "/policy",
    rewritePrefix: "/policy"
  });

  // 2. Serve the admin SPA. The static root is the Vite build output.
  // Default: when running from `dist/server.js`, the SPA is at `<pkg>/public/`.
  // When called from tests, allow an override (absolute or relative to cwd).
  const staticRoot = resolve(opts.staticRoot ?? cfg.ADMIN_STATIC_ROOT);
  if (existsSync(staticRoot)) {
    await app.register(fastifyStatic, {
      root: staticRoot,
      prefix: "/",
      wildcard: true,
      index: ["index.html"],
      // SPA fallback for client routes (e.g. /audit, /users). When the wildcard doesn't match a
      // file, send index.html so the React Router can take over.
      constraints: {}
    });
    // Explicit fallback for client routes. Registered AFTER the proxy so /v1/* never falls through.
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/v1/") || req.url.startsWith("/policy/")) {
        reply.code(404).send({ error: "NOT_FOUND", message: "Upstream endpoint not found" });
        return;
      }
      reply.sendFile("index.html");
    });
  } else {
    app.log.warn({ staticRoot }, "admin SPA static root not found; serving health-only");
  }

  return app;
}

async function main(): Promise<void> {
  const cfg = loadAdminPortalConfig();
  const app = await buildApp();
  await app.listen({ port: cfg.ADMIN_PORTAL_PORT, host: cfg.ADMIN_PORTAL_HOST });
  // eslint-disable-next-line no-console
  console.log(`[admin-portal] listening at http://${cfg.ADMIN_PORTAL_HOST}:${cfg.ADMIN_PORTAL_PORT}`);
  // eslint-disable-next-line no-console
  console.log(`[admin-portal] proxying /v1/* to ${cfg.CONTROL_PLANE_URL}`);
  // eslint-disable-next-line no-console
  console.log(`[admin-portal] static root: ${cfg.ADMIN_STATIC_ROOT}`);
}

const argv1 = (process.argv[1] ?? "").replace(/\\/g, "/");
const entryHref = new URL(import.meta.url).href.replace(/\\/g, "/");
const isEntry =
  argv1.endsWith("/server.ts") ||
  argv1.endsWith("/server.js") ||
  argv1.endsWith("/server.mjs") ||
  argv1.endsWith("/server.cjs") ||
  entryHref === argv1 ||
  entryHref === `file:///${argv1}` ||
  entryHref === `file://${argv1.startsWith("/") ? argv1 : "/" + argv1}`;
if (isEntry) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error("Failed to start admin-portal:", err);
    process.exit(1);
  });
}
