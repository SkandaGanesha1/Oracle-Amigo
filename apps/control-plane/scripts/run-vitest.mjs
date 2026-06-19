import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const vitestEntry = resolve(
  packageRoot,
  "node_modules",
  "vitest",
  "vitest.mjs"
);

const postgresUrl = process.env.CONTROL_PLANE_TEST_POSTGRES_URL;
const childEnv = {
  ...process.env,
  INIT_CWD: packageRoot,
  PWD: packageRoot,
  npm_config_prefix: packageRoot,
  CONTROL_PLANE_DB_DRIVER: "postgres",
  CONTROL_PLANE_DATABASE_URL: postgresUrl ?? "postgres://oracle:amigo@127.0.0.1:5432/oracle_amigo_test",
  DATABASE_URL: ""
};

const testTargets = postgresUrl ? [] : ["tests/config.test.ts", "tests/storage.test.ts"];

const result = spawnSync(
  process.execPath,
  [vitestEntry, "run", "--config", "vitest.config.mjs", "--configLoader", "runner", ...testTargets],
  {
    cwd: packageRoot,
    env: childEnv,
    stdio: "inherit"
  }
);

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);
