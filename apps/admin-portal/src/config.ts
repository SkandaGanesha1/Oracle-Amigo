import { z } from "zod";

const ConfigSchema = z.object({
  ADMIN_PORTAL_PORT: z.coerce.number().int().min(1).max(65535).default(3398),
  ADMIN_PORTAL_HOST: z.string().default("127.0.0.1"),
  CONTROL_PLANE_URL: z.string().url().default("http://127.0.0.1:8080"),
  // Path to the built admin SPA. In dev, the Vite dev server serves on :5174 directly so this
  // adapter is only used in production. Default points at the ui-admin dist output.
  ADMIN_STATIC_ROOT: z.string().default("public"),
  ADMIN_PORTAL_LOG_LEVEL: z.enum(["info", "debug", "warn", "error"]).default("info")
});

export type AdminPortalConfig = z.infer<typeof ConfigSchema>;

let _cached: AdminPortalConfig | null = null;

export function loadAdminPortalConfig(env: NodeJS.ProcessEnv = process.env): AdminPortalConfig {
  if (_cached) return _cached;
  const parsed = ConfigSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid admin-portal configuration:\n${issues}`);
  }
  _cached = parsed.data;
  return _cached;
}

export function resetAdminPortalConfigForTest(overrides: Record<string, string> = {}): void {
  for (const [k, v] of Object.entries(overrides)) {
    process.env[k] = v;
  }
  _cached = null;
}
