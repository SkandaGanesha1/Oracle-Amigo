import { z } from "zod";

const ConfigSchema = z.object({
  CONTROL_PLANE_PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  CONTROL_PLANE_HOST: z.string().default("127.0.0.1"),
  CONTROL_PLANE_PUBLIC_URL: z.string().url().default("http://localhost:8080"),
  CONTROL_PLANE_DB_PATH: z.string().default("./data/control-plane.db"),
  CONTROL_PLANE_ENV: z.enum(["development", "production", "test"]).default("development"),
  JWT_ACCESS_SECRET: z.string().min(16).default("dev-access-secret-change-me-in-production-32chars"),
  JWT_REFRESH_SECRET: z.string().min(16).default("dev-refresh-secret-change-me-in-production-32chars"),
  TOKEN_ISSUER: z.string().default("oracle-amigo-control-plane"),
  DEFAULT_ORG_SLUG: z.string().default("local-dev"),
  FILE_TRANSFER_STORE: z.string().default("./data/transfers"),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).default(900),
  REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().min(3600).default(2592000),
  RELAY_POLL_MAX_BATCH: z.coerce.number().int().min(1).max(500).default(50),
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
  // AES-256-GCM key (32 bytes raw, or any string — we sha256-derive to 32 bytes). Encrypts TOTP secrets at rest.
  ADMIN_KEK: z.string().min(32).default("dev-admin-kek-change-me-32chars-please!"),
  // Set to "true" (1) to opt into the __Host-admin_session cookie name. In dev (CONTROL_PLANE_ENV=development)
  // we use the unprefixed `admin_session` because browsers reject __Host- over plain HTTP.
  ADMIN_COOKIE_HOST_PREFIX: z.enum(["true", "false"]).default("false"),
  // Optional one-time bootstrap: a static header token that grants admin access without a session.
  // Useful for first-run setup when no admin account exists yet. Never set in production.
  ADMIN_BOOTSTRAP_TOKEN: z.string().optional(),
  // Production first-admin setup requires an explicit short-lived operator decision.
  ADMIN_SETUP_ENABLED: z.enum(["true", "false"]).default("false")
});

export type Config = z.infer<typeof ConfigSchema>;

let _cached: Config | null = null;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  if (_cached) return _cached;
  const parsed = ConfigSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid control plane configuration:\n${issues}`);
  }
  const cfg = parsed.data;
  if (cfg.CONTROL_PLANE_ENV === "production") {
    if (cfg.JWT_ACCESS_SECRET.includes("change-me")) {
      throw new Error("JWT_ACCESS_SECRET must be changed in production");
    }
    if (cfg.JWT_REFRESH_SECRET.includes("change-me")) {
      throw new Error("JWT_REFRESH_SECRET must be changed in production");
    }
    if (cfg.ADMIN_KEK.includes("change-me")) {
      throw new Error("ADMIN_KEK must be changed in production");
    }
    if (cfg.ADMIN_BOOTSTRAP_TOKEN && cfg.ADMIN_BOOTSTRAP_TOKEN.length > 0) {
      throw new Error("ADMIN_BOOTSTRAP_TOKEN must be unset in production");
    }
    if (cfg.ADMIN_COOKIE_HOST_PREFIX !== "true") {
      throw new Error("ADMIN_COOKIE_HOST_PREFIX must be 'true' in production");
    }
  }
  _cached = cfg;
  return cfg;
}

export function resetConfigForTest(overrides: Record<string, string> = {}): void {
  for (const [k, v] of Object.entries(overrides)) {
    process.env[k] = v;
  }
  _cached = null;
}
