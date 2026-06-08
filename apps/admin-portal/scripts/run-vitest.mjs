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

const childEnv = {
  ...process.env,
  INIT_CWD: packageRoot,
  PWD: packageRoot,
  npm_config_prefix: packageRoot
};

const result = spawnSync(
  process.execPath,
  [vitestEntry, "run", "--config", "vitest.config.mjs", "--configLoader", "runner"],
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
