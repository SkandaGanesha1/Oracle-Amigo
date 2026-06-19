import { generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig, resetConfigForTest } from "../src/config.js";

const previousEnv = { ...process.env };

afterEach(() => {
  process.env = { ...previousEnv };
  resetConfigForTest({});
});

describe("control plane production config validation", () => {
  it("rejects HTTP public URLs in production", () => {
    withEnv({ CONTROL_PLANE_PUBLIC_URL: "http://control-plane.internal:8080" });

    expect(() => loadConfig()).toThrow(/CONTROL_PLANE_PUBLIC_URL must use HTTPS/);
  });

  it("accepts HTTP public URLs only with the explicit unsafe override", () => {
    withEnv({
      CONTROL_PLANE_PUBLIC_URL: "http://control-plane.internal:8080",
      CONTROL_PLANE_ALLOW_INSECURE_PUBLIC_URL: "true"
    });

    expect(loadConfig().CONTROL_PLANE_PUBLIC_URL).toBe("http://control-plane.internal:8080");
  });

  it("rejects weak JWT secrets and equal access/refresh secrets in production", () => {
    withEnv({
      JWT_ACCESS_SECRET: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      JWT_REFRESH_SECRET: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    });

    expect(() => loadConfig()).toThrow(/JWT_ACCESS_SECRET must contain enough character variety[\s\S]*JWT_REFRESH_SECRET must contain enough character variety[\s\S]*JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different/);
  });

  it("requires ADMIN_KEK to be explicitly strong in production", () => {
    const env = baseProductionEnv();
    delete env.ADMIN_KEK;
    withRawEnv(env);

    expect(() => loadConfig()).toThrow(/ADMIN_KEK must be explicitly set in production/);
  });

  it("rejects DEV_ADMIN_TOKEN and ADMIN_BOOTSTRAP_TOKEN in production", () => {
    withEnv({
      DEV_ADMIN_TOKEN: "static-dev-admin-token-should-not-work",
      ADMIN_BOOTSTRAP_TOKEN: "static-bootstrap-token-should-not-work"
    });

    expect(() => loadConfig()).toThrow(/DEV_ADMIN_TOKEN must be unset in production[\s\S]*ADMIN_BOOTSTRAP_TOKEN must be unset in production/);
  });

  it("rejects wildcard CORS in production", () => {
    withEnv({ CONTROL_PLANE_CORS_ORIGIN: "*" });

    expect(() => loadConfig()).toThrow(/CONTROL_PLANE_CORS_ORIGIN must not be '\*' in production/);
  });

  it("requires secure admin cookie settings in production", () => {
    withEnv({ ADMIN_COOKIE_HOST_PREFIX: "false" });

    expect(() => loadConfig()).toThrow(/ADMIN_COOKIE_HOST_PREFIX must be 'true' in production/);
  });

  it("requires a Postgres URL", () => {
    const env = baseProductionEnv();
    delete env.CONTROL_PLANE_DATABASE_URL;
    withRawEnv(env);

    expect(() => loadConfig()).toThrow(/CONTROL_PLANE_DATABASE_URL or DATABASE_URL must be set/);
  });

  it("keeps development mode usable with an explicit Postgres URL", () => {
    process.env = {
      CONTROL_PLANE_ENV: "development",
      NODE_ENV: "development",
      CONTROL_PLANE_DATABASE_URL: "postgres://oracle:amigo@localhost:5432/oracle_amigo_dev"
    };
    resetConfigForTest({});

    expect(loadConfig().CONTROL_PLANE_ENV).toBe("development");
  });

  it("sets bounded relay retry defaults", () => {
    process.env = {
      CONTROL_PLANE_ENV: "development",
      NODE_ENV: "development",
      CONTROL_PLANE_DATABASE_URL: "postgres://oracle:amigo@localhost:5432/oracle_amigo_dev"
    };
    resetConfigForTest({});

    const cfg = loadConfig();
    expect(cfg.RELAY_MAX_DELIVERY_ATTEMPTS).toBe(5);
    expect(cfg.RELAY_RETRY_BASE_MS).toBe(5000);
    expect(cfg.RELAY_RETRY_MAX_MS).toBe(300000);
    expect(cfg.RELAY_TASK_TTL_SECONDS).toBe(86400);
  });
});

function withEnv(overrides: NodeJS.ProcessEnv): void {
  process.env = { ...baseProductionEnv(), ...overrides };
  resetConfigForTest({});
}

function withRawEnv(env: NodeJS.ProcessEnv): void {
  process.env = { ...env };
  resetConfigForTest({});
}

function baseProductionEnv(): NodeJS.ProcessEnv {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return {
    NODE_ENV: "production",
    CONTROL_PLANE_ENV: "production",
    CONTROL_PLANE_PUBLIC_URL: "https://control-plane.oracle-amigo.test",
    CONTROL_PLANE_DATABASE_URL: "postgres://oracle:amigo@db.example.test:5432/oracle_amigo",
    JWT_ACCESS_SECRET: "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6",
    JWT_REFRESH_SECRET: "Z9y8X7w6V5u4T3s2R1q0P9o8N7m6L5k4",
    JWT_PRIVATE_KEY_PEM: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    JWT_PUBLIC_KEY_PEM: publicKey.export({ type: "spki", format: "pem" }).toString(),
    ADMIN_KEK: "K1a2B3c4D5e6F7g8H9i0J1k2L3m4N5o6",
    TRANSFER_KEK: "T1r2A3n4S5f6E7r8K9e0Y1m2A3t4R5x6",
    ADMIN_COOKIE_HOST_PREFIX: "true",
    METRICS_ENABLED: "false"
  };
}
