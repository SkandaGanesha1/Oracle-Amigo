import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "..");

function readPortalSource(rel: string): string {
  const p = resolve(ROOT, rel);
  if (!existsSync(p)) throw new Error(`missing portal source: ${rel}`);
  return readFileSync(p, "utf8");
}

function readServerSource(rel: string): string {
  const p = resolve(ROOT, rel);
  if (!existsSync(p)) throw new Error(`missing server source: ${rel}`);
  return readFileSync(p, "utf8");
}

describe("admin portal source integrity", () => {
  it("every required page is implemented (no empty stubs)", () => {
    const pages = [
      "OverviewPage",
      "UsersPage",
      "DevicesPage",
      "AgentInstancesPage",
      "PresencePage",
      "TasksPage",
      "TransfersPage",
      "AuditPage",
      "OrgSnapshotPage"
    ];
    for (const name of pages) {
      const src = readPortalSource(`ui-admin/src/portal/pages/${name}.tsx`);
      expect(src.length, `${name} is suspiciously small`).toBeGreaterThan(800);
      expect(src).toMatch(/export const \w+:/);
    }
  });

  it("every required shared component exists", () => {
    const components = [
      "Card",
      "ChainIntegrityBadge",
      "CopyableId",
      "DataTable",
      "EmptyState",
      "ErrorState",
      "KV",
      "RefreshButton",
      "Skeleton",
      "StatusPill",
      "TimeAgo",
      "VirtualDataTable"
    ];
    for (const name of components) {
      const src = readPortalSource(`ui-admin/src/portal/components/${name}.tsx`);
      expect(src.length, `${name} is empty`).toBeGreaterThan(50);
    }
  });

  it("auth flow primitives exist (login + setup + session + qr + banner)", () => {
    expect(readPortalSource("ui-admin/src/portal/auth/useSession.ts")).toContain("useSession");
    expect(readPortalSource("ui-admin/src/portal/auth/useSetupStatus.ts")).toContain("useSetupStatus");
    expect(readPortalSource("ui-admin/src/portal/auth/LoginFlow.tsx")).toContain("loginStep1");
    expect(readPortalSource("ui-admin/src/portal/auth/SetupFlow.tsx")).toContain("setupFirstAdmin");
    expect(readPortalSource("ui-admin/src/portal/auth/SessionBanner.tsx")).toContain("logout");
    expect(readPortalSource("ui-admin/src/portal/auth/QrCode.tsx")).toContain("qrcode");
    expect(readPortalSource("ui-admin/src/portal/auth/api.ts")).toContain("/v1/admin/auth/login");
    expect(readPortalSource("ui-admin/src/portal/auth/api.ts")).toContain("/v1/admin/auth/me");
    expect(readPortalSource("ui-admin/src/portal/auth/api.ts")).toContain("/v1/admin/auth/setup");
    expect(readPortalSource("ui-admin/src/portal/auth/api.ts")).toContain("/v1/admin/auth/logout");
    expect(readPortalSource("ui-admin/src/portal/auth/api.ts")).toContain("/v1/admin/auth/mfa/verify");
    expect(readPortalSource("ui-admin/src/portal/auth/api.ts")).toContain("/v1/admin/auth/mfa/recovery");
  });

  it("portal root provides TanStack Query before bootstrap/login hooks run", () => {
    const main = readPortalSource("ui-admin/src/main.tsx");
    const layout = readPortalSource("ui-admin/src/portal/layout/AdminLayout.tsx");
    const queryClient = readPortalSource("ui-admin/src/portal/api/queryClient.ts");
    const rootErrorBoundary = readPortalSource("ui-admin/src/portal/RootErrorBoundary.tsx");

    expect(main).toContain("QueryClientProvider");
    expect(main).toContain("createAdminQueryClient");
    expect(main).toContain("RootErrorBoundary");
    expect(main).toMatch(/<QueryClientProvider client=\{queryClient\}>\s*<PortalApp \/>/);
    expect(layout).not.toContain("QueryClientProvider");
    expect(queryClient).toContain("new QueryClient");
    expect(queryClient).toContain("ApiError");
    expect(rootErrorBoundary).toContain("Admin portal failed to start");
  });

  it("layout primitives exist and are cookie-based (no sessionStorage/X-Admin-Token)", () => {
    expect(readPortalSource("ui-admin/src/portal/layout/AdminRouter.tsx")).toContain("hashchange");
    expect(readPortalSource("ui-admin/src/portal/layout/Header.tsx")).toContain("uptime");
    expect(readPortalSource("ui-admin/src/portal/layout/Sidebar.tsx")).toContain("/audit");
    expect(readPortalSource("ui-admin/src/portal/layout/ThemeToggle.tsx")).toContain("localStorage");
    // No legacy admin-token patterns
    const allLayout = [
      "ui-admin/src/portal/layout/AdminLayout.tsx",
      "ui-admin/src/portal/layout/Header.tsx",
      "ui-admin/src/portal/layout/Sidebar.tsx",
      "ui-admin/src/portal/PortalApp.tsx"
    ];
    for (const rel of allLayout) {
      const src = readPortalSource(rel);
      expect(src, `${rel} still references X-Admin-Token`).not.toContain("X-Admin-Token");
      expect(src, `${rel} still references the old token storage key`).not.toContain("oracle-amigo.admin.token");
    }
  });

  it("queries module wires every admin endpoint (data API)", () => {
    const src = readPortalSource("ui-admin/src/portal/api/queries.ts");
    expect(src).toContain("/v1/admin/info");
    expect(src).toContain("/v1/admin/users");
    expect(src).toContain("/v1/admin/devices");
    expect(src).toContain("/v1/admin/agent-instances");
    expect(src).toContain("/v1/admin/presence");
    expect(src).toContain("/v1/admin/tasks");
    expect(src).toContain("/v1/admin/transfers");
    expect(src).toContain("/v1/admin/audit");
    expect(src).toContain("/v1/admin/orgs/");
  });

  it("API client is cookie-based and never logs the token", () => {
    const src = readPortalSource("ui-admin/src/portal/api/client.ts");
    expect(src).toContain("credentials");
    // No X-Admin-Token header, no sessionStorage lookup
    expect(src).not.toContain("X-Admin-Token");
    expect(src).not.toContain("sessionStorage.getItem");
    // token must not be written to console
    expect(src).not.toMatch(/console\.(log|info|debug)\([^)]*token/i);
  });

  it("UI types mirror AdminRoutes response shapes", () => {
    const routes = readServerSource("apps/control-plane/src/admin/AdminRoutes.ts");
    const types = readPortalSource("ui-admin/src/portal/api/types.ts");
    for (const path of [
      "/v1/admin/users",
      "/v1/admin/devices",
      "/v1/admin/agent-instances",
      "/v1/admin/presence",
      "/v1/admin/tasks",
      "/v1/admin/transfers",
      "/v1/admin/audit",
      "/v1/admin/orgs/:org_id/snapshot",
      "/v1/admin/info"
    ]) {
      expect(routes, `server routes missing ${path}`).toContain(path);
    }
    for (const name of [
      "AdminUser",
      "AdminDevice",
      "AdminAgentInstance",
      "AdminPresence",
      "AdminTask",
      "AdminTransfer",
      "AdminAuditEvent",
      "AdminInfo",
      "AdminOrgSnapshot"
    ]) {
      expect(types, `UI types missing ${name}`).toContain(`export interface ${name}`);
    }
  });

  it("App.tsx no longer embeds the admin tab or admin gate", () => {
    const app = readPortalSource("ui/src/App.tsx");
    expect(app, "chat App.tsx still references AdminGate").not.toContain("AdminGate");
    expect(app, "chat App.tsx still references AdminLayout").not.toContain("AdminLayout");
    expect(app, "chat App.tsx still has Admin Console tab").not.toContain("Admin Console");
  });

  it("admin portal apps/admin-portal/static-served entry point exists", () => {
    expect(readServerSource("apps/admin-portal/src/server.ts")).toContain("@fastify/http-proxy");
    expect(readServerSource("apps/admin-portal/src/server.ts")).toContain("@fastify/static");
    expect(readServerSource("apps/admin-portal/src/config.ts").length).toBeGreaterThan(0);
  });

  it("control-plane wires the new auth routes and the @fastify/cookie plugin", () => {
    const main = readServerSource("apps/control-plane/src/main.ts");
    expect(main).toContain("@fastify/cookie");
    expect(main).toContain("registerAdminAuthRoutes");
    const authRoutes = readServerSource("apps/control-plane/src/admin/AdminAuthRoutes.ts");
    expect(authRoutes).toContain("/v1/admin/auth/setup-status");
    expect(authRoutes).toContain("/v1/admin/auth/setup");
    expect(authRoutes).toContain("/v1/admin/auth/login");
    expect(authRoutes).toContain("/v1/admin/auth/mfa/verify");
    expect(authRoutes).toContain("/v1/admin/auth/mfa/recovery");
    expect(authRoutes).toContain("/v1/admin/auth/me");
    expect(authRoutes).toContain("/v1/admin/auth/logout");
  });
});
