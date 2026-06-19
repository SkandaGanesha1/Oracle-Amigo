import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const allowedScripts = new Set(["dev:ui"]);
const script = process.argv[2];

if (!allowedScripts.has(script)) {
  console.error(`[desktop-shell] root script is not allowlisted: ${script ?? "<missing>"}`);
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..", "..");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const env = Object.fromEntries(
  Object.entries(process.env).filter(([key, value]) => value !== undefined && !key.startsWith("=") && !key.startsWith("npm_"))
);

delete env.INIT_CWD;

const child = spawn(npm, ["run", script], {
  cwd: root,
  env,
  shell: true,
  stdio: "inherit"
});

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`[desktop-shell] root script ${script} exited by signal ${signal}`);
    process.exit(1);
  }
  process.exit(code ?? 1);
});

child.on("error", (error) => {
  console.error(`[desktop-shell] failed to run root script ${script}: ${error.message}`);
  process.exit(1);
});
