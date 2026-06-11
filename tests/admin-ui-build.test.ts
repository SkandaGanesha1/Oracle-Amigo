import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "..");
const CHAT_PUBLIC_DIR = join(ROOT, "public");
const PORTAL_PUBLIC_DIR = join(ROOT, "apps/admin-portal/public");

function listChatAssets(): string[] {
  if (!existsSync(CHAT_PUBLIC_DIR)) return [];
  const dir = join(CHAT_PUBLIC_DIR, "assets");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).map((name) => join(dir, name));
}

function listPortalAssets(): string[] {
  if (!existsSync(PORTAL_PUBLIC_DIR)) return [];
  const dir = join(PORTAL_PUBLIC_DIR, "assets");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).map((name) => join(dir, name));
}

function findChatBundle(): { js: string; css: string; html: string } | null {
  if (!existsSync(CHAT_PUBLIC_DIR)) return null;
  const assetsDir = join(CHAT_PUBLIC_DIR, "assets");
  if (!existsSync(assetsDir)) return null;
  const files = readdirSync(assetsDir);
  const jsFiles = files.filter((f) => f.endsWith(".js"));
  const css = files.find((f) => f.startsWith("index-") && f.endsWith(".css")) ?? files.find((f) => f.endsWith(".css"));
  if (jsFiles.length === 0 || !css) return null;
  // Pick the largest JS file (the main bundle) rather than the first alphabetically
  jsFiles.sort((a, b) => statSync(join(assetsDir, b)).size - statSync(join(assetsDir, a)).size);
  return {
    js: join(assetsDir, jsFiles[0]),
    css: join(assetsDir, css),
    html: join(CHAT_PUBLIC_DIR, "index.html")
  };
}

function findPortalBundle(): { js: string; css: string; html: string } | null {
  if (!existsSync(PORTAL_PUBLIC_DIR)) return null;
  const assetsDir = join(PORTAL_PUBLIC_DIR, "assets");
  if (!existsSync(assetsDir)) return null;
  const files = readdirSync(assetsDir);
  const js = files.find((f) => f.endsWith(".js"));
  const css = files.find((f) => f.endsWith(".css"));
  if (!js || !css) return null;
  return {
    js: join(assetsDir, js),
    css: join(assetsDir, css),
    html: join(PORTAL_PUBLIC_DIR, "index.html")
  };
}

function buildIfMissing(bundle: { js: string; css: string; html: string } | null, cmd: string, args: string[]) {
  if (bundle) return;
  // On Windows, `npm` is `npm.cmd`; without `shell: true` execFileSync cannot resolve it
  // and throws ENOENT. Using shell mode is the documented workaround for npm.cmd on win32.
  execFileSync(cmd, args, { cwd: ROOT, stdio: "pipe", shell: process.platform === "win32" });
}

describe("chat build is admin-free", () => {
  it("ships a built chat bundle with TanStack runtime present", () => {
    const bundle = findChatBundle();
    buildIfMissing(bundle, "npm", ["run", "build"]);
    const resolved = findChatBundle();
    expect(resolved, "vite build did not produce chat assets").toBeTruthy();
    for (const file of Object.values(resolved!)) {
      expect(statSync(file).size, `${file} is empty`).toBeGreaterThan(0);
    }
  });

  it("chat bundle does NOT embed admin code (token, TOTP, recovery, portal routes)", () => {
    const bundle = findChatBundle();
    buildIfMissing(bundle, "npm", ["run", "build"]);
    const resolved = findChatBundle()!;
    const js = readFileSync(resolved.js, "utf8");
    // Legacy X-Admin-Token and sessionStorage admin-token code are gone
    expect(js, "chat bundle still contains X-Admin-Token header code").not.toContain("X-Admin-Token");
    expect(js, "chat bundle still contains legacy admin token storage key").not.toContain("oracle-amigo.admin.token");
    // New portal auth surfaces are in ui-admin, never in the chat bundle
    expect(js, "chat bundle leaked TOTP provisioning strings").not.toContain("TOTP");
    expect(js, "chat bundle leaked recovery-code strings").not.toContain("recovery_codes");
    expect(js, "chat bundle leaked __Host- cookie name").not.toContain("__Host-admin_session");
    expect(js, "chat bundle leaked admin auth route paths").not.toContain("/v1/admin/auth/login");
    expect(js, "chat bundle leaked admin auth route paths").not.toContain("/v1/admin/auth/setup");
    // The chat bundle retains the product chat surfaces
    expect(js, "chat bundle no longer renders Agentic Chat identity").toContain("Oracle Amigo Local Agent");
    expect(js, "chat bundle no longer renders Approval Workflow").toContain("Approval Workflow");
    expect(js, "chat bundle no longer includes relay file request client").toContain("/relay/send-file-request");
  });

  it("chat index.html references the new asset filenames", () => {
    const bundle = findChatBundle();
    buildIfMissing(bundle, "npm", ["run", "build"]);
    const resolved = findChatBundle()!;
    const html = readFileSync(resolved.html, "utf8");
    expect(html).toMatch(/assets\/index-[A-Za-z0-9_-]+\.js/);
    expect(html).toMatch(/assets\/index-[A-Za-z0-9_-]+\.css/);
  });

  it("chat CSS bundle still includes Tailwind primitives", () => {
    const bundle = findChatBundle();
    buildIfMissing(bundle, "npm", ["run", "build"]);
    const resolved = findChatBundle()!;
    const css = readFileSync(resolved.css, "utf8");
    expect(css).toMatch(/text-white/);
    expect(css).toMatch(/rounded-/);
  });

  it("does not embed a build-time admin token env var", () => {
    const bundle = findChatBundle();
    buildIfMissing(bundle, "npm", ["run", "build"]);
    const resolved = findChatBundle()!;
    const js = readFileSync(resolved.js, "utf8");
    expect(js).not.toContain("VITE_DEV_ADMIN_TOKEN");
    expect(js).not.toContain("import.meta.env.VITE_ADMIN");
  });

  it("listing of public/assets is non-empty after at least one build", () => {
    const files = listChatAssets();
    expect(files.length).toBeGreaterThanOrEqual(2);
  });
});

describe("admin portal build artifacts", () => {
  it("ships a built portal bundle (ui-admin build → apps/admin-portal/public)", () => {
    const bundle = findPortalBundle();
    buildIfMissing(bundle, "npm", ["run", "--prefix", "ui-admin", "build"]);
    const resolved = findPortalBundle();
    expect(resolved, "ui-admin build did not produce portal assets").toBeTruthy();
    for (const file of Object.values(resolved!)) {
      expect(statSync(file).size, `${file} is empty`).toBeGreaterThan(0);
    }
  });

  it("portal bundle includes auth surfaces and operator UX", () => {
    const bundle = findPortalBundle();
    buildIfMissing(bundle, "npm", ["run", "--prefix", "ui-admin", "build"]);
    const resolved = findPortalBundle()!;
    // Read the entry chunk (index-*.js) which contains the app code, not the first
    // alphabetically-sorted file (which is the qrcode code-split chunk `browser-*.js`).
    const assetsDir = join(PORTAL_PUBLIC_DIR, "assets");
    const indexJs = readdirSync(assetsDir).find((f) => f.startsWith("index-") && f.endsWith(".js"));
    expect(indexJs, "no index-*.js entry chunk in portal bundle").toBeTruthy();
    const js = readFileSync(join(assetsDir, indexJs!), "utf8");
    // Endpoint paths
    expect(js).toContain("/v1/admin/auth/setup-status");
    expect(js).toContain("/v1/admin/auth/login");
    expect(js).toContain("/v1/admin/auth/setup");
    expect(js).toContain("/v1/admin/auth/mfa/verify");
    expect(js).toContain("/v1/admin/auth/mfa/recovery");
    expect(js).toContain("/v1/admin/auth/me");
    expect(js).toContain("/v1/admin/auth/logout");
    // User-visible strings (not minified)
    expect(js).toContain("Oracle Amigo Admin");
    expect(js).toContain("Bootstrap first admin");
    expect(js).toContain("Control Plane Monitor");
    expect(js).toContain("Design System / Component Lab");
    expect(js).toContain("Component Lab");
    // Cookie-based, no legacy token header
    expect(js).not.toContain("X-Admin-Token");
    // Data API paths are still there (read-only console)
    expect(js).toContain("/v1/admin/audit");
    expect(js).toContain("/v1/admin/users");
    // Bundle size sanity
    expect(js.length, "portal bundle should be > 200KB after TanStack + qrcode + admin").toBeGreaterThan(200_000);
  });

  it("portal index.html references the new asset filenames", () => {
    const bundle = findPortalBundle();
    buildIfMissing(bundle, "npm", ["run", "--prefix", "ui-admin", "build"]);
    const resolved = findPortalBundle()!;
    const html = readFileSync(resolved.html, "utf8");
    expect(html).toMatch(/assets\/index-[A-Za-z0-9_-]+\.js/);
    expect(html).toMatch(/assets\/index-[A-Za-z0-9_-]+\.css/);
  });

  it("listing of apps/admin-portal/public/assets is non-empty after at least one build", () => {
    const files = listPortalAssets();
    expect(files.length).toBeGreaterThanOrEqual(2);
  });
});
