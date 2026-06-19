import { z } from "zod";

const ConfigSchema = z.object({
  NODE_ENV: z.string().optional(),
  CONTROL_PLANE_PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  CONTROL_PLANE_HOST: z.string().default("127.0.0.1"),
  CONTROL_PLANE_PUBLIC_URL: z.string().url().default("http://localhost:8080"),
  CONTROL_PLANE_ALLOW_INSECURE_PUBLIC_URL: z.enum(["true", "false"]).default("false"),
  CONTROL_PLANE_CORS_ORIGIN: z.string().optional(),
  CONTROL_PLANE_DATABASE_URL: z.string().optional(),
  DATABASE_URL: z.string().optional(),
  CONTROL_PLANE_PG_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  CONTROL_PLANE_PG_IDLE_TIMEOUT_MS: z.coerce.number().int().min(1000).default(30000),
  CONTROL_PLANE_PG_CONNECTION_TIMEOUT_MS: z.coerce.number().int().min(1000).default(5000),
  CONTROL_PLANE_ENV: z.enum(["development", "production", "test"]).default("development"),
  CONTROL_PLANE_DEPLOYMENT_TIER: z.enum(["pilot", "enterprise"]).default("pilot"),
  JWT_ACCESS_SECRET: z.string().min(16).default("dev-access-secret-change-me-in-production-32chars"),
  JWT_REFRESH_SECRET: z.string().min(16).default("dev-refresh-secret-change-me-in-production-32chars"),
  JWT_PRIVATE_KEY_PEM: z.string().optional(),
  JWT_PUBLIC_KEY_PEM: z.string().optional(),
  TOKEN_ISSUER: z.string().default("oracle-amigo-control-plane"),
  DEFAULT_ORG_SLUG: z.string().default("local-dev"),
  FILE_TRANSFER_STORE: z.string().default("./data/transfers"),
  TRANSFER_KEK: z.string().min(32).default("dev-transfer-kek-change-me-32chars!"),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).default(900),
  REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().min(3600).default(2592000),
  RELAY_POLL_MAX_BATCH: z.coerce.number().int().min(1).max(500).default(50),
  RELAY_MAX_DELIVERY_ATTEMPTS: z.coerce.number().int().min(1).max(100).default(5),
  RELAY_RETRY_BASE_MS: z.coerce.number().int().min(100).default(5000),
  RELAY_RETRY_MAX_MS: z.coerce.number().int().min(100).default(300000),
  RELAY_TASK_TTL_SECONDS: z.coerce.number().int().min(60).default(86400),
  TRANSFER_TTL_SECONDS: z.coerce.number().int().min(60).default(3600),
  TRANSFER_MAX_FILE_SIZE_BYTES: z.coerce.number().int().min(1024).default(104857600),
  DEV_ADMIN_TOKEN: z.string().optional(),
  ARGON2_MEMORY_COST: z.coerce.number().int().min(1024).default(19456),
  ARGON2_TIME_COST: z.coerce.number().int().min(1).default(2),
  ARGON2_PARALLELISM: z.coerce.number().int().min(1).default(1),
  // Phase 15b: Admin Portal session/cookie/auth config. 1h idle / 8h absolute matches Stripe & AWS Console.
  ADMIN_SESSION_IDLE_TTL_SECONDS: z.coerce.number().int().min(300).default(3600),
  ADMIN_SESSION_ABSOLUTE_TTL_SECONDS: z.coerce.number().int().min(3600).default(28800),
  ADMIN_LOGIN_RATELIMIT_PER_EMAIL: z.coerce.number().int().min(1).default(5),
  ADMIN_LOGIN_RATELIMIT_PER_IP: z.coerce.number().int().min(1).default(20),
  ADMIN_LOGIN_LOCKOUT_MINUTES: z.coerce.number().int().min(1).default(15),
  // AES-256-GCM key (32 bytes raw, or any string; we sha256-derive to 32 bytes). Encrypts TOTP secrets at rest.
  ADMIN_KEK: z.string().min(32).default("dev-admin-kek-change-me-32chars-please!"),
  // Set to "true" (1) to opt into the __Host-admin_session cookie name. In dev (CONTROL_PLANE_ENV=development)
  // we use the unprefixed `admin_session` because browsers reject __Host- over plain HTTP.
  ADMIN_COOKIE_HOST_PREFIX: z.enum(["true", "false"]).default("false"),
  // Optional one-time bootstrap: a static header token that grants admin access without a session.
  // Useful for first-run setup when no admin account exists yet. Never set in production.
  ADMIN_BOOTSTRAP_TOKEN: z.string().optional(),
  // Production first-admin setup requires an explicit short-lived operator decision.
  ADMIN_SETUP_ENABLED: z.enum(["true", "false"]).default("false"),
  // Optional RS256 key used to re-sign control-plane rewritten cloud Agent Cards.
  AGENT_CARD_SIGNING_PRIVATE_KEY_PEM: z.string().optional(),
  AGENT_CARD_SIGNING_KEY_ID: z.string().default("control-plane-agent-card"),

  // Prometheus metrics
  METRICS_ENABLED: z.enum(["true", "false"]).default("true"),
  METRICS_ENDPOINT: z.string().default("/metrics")
});

export type Config = z.infer<typeof ConfigSchema>;

let _cached: Config | null = null;

const DEV_SECRET_DEFAULTS = new Set([
  "dev-access-secret-change-me-in-production-32chars",
  "dev-refresh-secret-change-me-in-production-32chars",
  "dev-transfer-kek-change-me-32chars!",
  "dev-admin-kek-change-me-32chars-please!"
]);

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  if (_cached) return _cached;
  const parsed = ConfigSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid control plane configuration:\n${issues}`);
  }
  const cfg = parsed.data;
  const databaseIssues = validateDatabaseConfig(cfg);
  if (databaseIssues.length > 0) {
    throw new Error(`Invalid control plane database configuration:\n${databaseIssues.map((issue) => `  - ${issue}`).join("\n")}`);
  }
  const productionIssues = validateProductionConfig(cfg, env);
  if (productionIssues.length > 0) {
    throw new Error(`Unsafe control plane production configuration:\n${productionIssues.map((issue) => `  - ${issue}`).join("\n")}`);
  }
  _cached = cfg;
  return cfg;
}

export function isEffectiveProduction(cfg: Pick<Config, "NODE_ENV" | "CONTROL_PLANE_ENV">): boolean {
  return cfg.NODE_ENV === "production" || cfg.CONTROL_PLANE_ENV === "production";
}

function validateDatabaseConfig(cfg: Config): string[] {
  const issues: string[] = [];
  if (!resolvedPostgresUrl(cfg)) {
    issues.push("CONTROL_PLANE_DATABASE_URL or DATABASE_URL must be set");
  }
  return issues;
}

export function resolvedPostgresUrl(cfg: Pick<Config, "CONTROL_PLANE_DATABASE_URL" | "DATABASE_URL">): string | undefined {
  return cfg.CONTROL_PLANE_DATABASE_URL?.trim() || cfg.DATABASE_URL?.trim() || undefined;
}

function validateProductionConfig(cfg: Config, env: NodeJS.ProcessEnv): string[] {
  if (!isEffectiveProduction(cfg)) return [];

  const issues: string[] = [];
  if (new URL(cfg.CONTROL_PLANE_PUBLIC_URL).protocol !== "https:" && cfg.CONTROL_PLANE_ALLOW_INSECURE_PUBLIC_URL !== "true") {
    issues.push("CONTROL_PLANE_PUBLIC_URL must use HTTPS in production unless CONTROL_PLANE_ALLOW_INSECURE_PUBLIC_URL=true");
  }
  appendStrongSecretIssues(issues, "JWT_ACCESS_SECRET", cfg.JWT_ACCESS_SECRET, env.JWT_ACCESS_SECRET);
  appendStrongSecretIssues(issues, "JWT_REFRESH_SECRET", cfg.JWT_REFRESH_SECRET, env.JWT_REFRESH_SECRET);
  appendStrongSecretIssues(issues, "ADMIN_KEK", cfg.ADMIN_KEK, env.ADMIN_KEK);
  appendStrongSecretIssues(issues, "TRANSFER_KEK", cfg.TRANSFER_KEK, env.TRANSFER_KEK);
  if (cfg.JWT_ACCESS_SECRET === cfg.JWT_REFRESH_SECRET) {
    issues.push("JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different in production");
  }
  if (!cfg.JWT_PRIVATE_KEY_PEM || !cfg.JWT_PUBLIC_KEY_PEM) {
    issues.push("JWT_PRIVATE_KEY_PEM and JWT_PUBLIC_KEY_PEM must be set in production");
  }
  if (cfg.DEV_ADMIN_TOKEN && cfg.DEV_ADMIN_TOKEN.length > 0) {
    issues.push("DEV_ADMIN_TOKEN must be unset in production");
  }
  if (cfg.ADMIN_BOOTSTRAP_TOKEN && cfg.ADMIN_BOOTSTRAP_TOKEN.length > 0) {
    issues.push("ADMIN_BOOTSTRAP_TOKEN must be unset in production");
  }
  if (cfg.ADMIN_COOKIE_HOST_PREFIX !== "true") {
    issues.push("ADMIN_COOKIE_HOST_PREFIX must be 'true' in production");
  }
  if (cfg.CONTROL_PLANE_CORS_ORIGIN?.trim() === "*") {
    issues.push("CONTROL_PLANE_CORS_ORIGIN must not be '*' in production");
  }
  return issues;
}

function appendStrongSecretIssues(issues: string[], name: string, value: string, rawValue: string | undefined): void {
  const trimmed = value.trim();
  if (!rawValue || rawValue.trim().length === 0) {
    issues.push(`${name} must be explicitly set in production`);
    return;
  }
  if (trimmed.length < 32) {
    issues.push(`${name} must be at least 32 characters in production`);
  }
  if (DEV_SECRET_DEFAULTS.has(trimmed) || /change[-_ ]?me|changeme|password|example|default|pilot|rotate[-_ ]?before[-_ ]?shared[-_ ]?use/i.test(trimmed)) {
    issues.push(`${name} must not use a known development default or placeholder`);
  }
  if (new Set(trimmed).size < 8) {
    issues.push(`${name} must contain enough character variety for production use`);
  }
}

export function resetConfigForTest(overrides: Record<string, string> = {}): void {
  for (const [k, v] of Object.entries(overrides)) {
    process.env[k] = v;
  }
  _cached = null;
}
