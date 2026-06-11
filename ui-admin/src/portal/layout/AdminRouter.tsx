import { useEffect, useState, type FC } from "react";
import { OverviewPage } from "../pages/OverviewPage";
import { UsersPage } from "../pages/UsersPage";
import { DevicesPage } from "../pages/DevicesPage";
import { AgentInstancesPage } from "../pages/AgentInstancesPage";
import { PresencePage } from "../pages/PresencePage";
import { TasksPage } from "../pages/TasksPage";
import { TransfersPage } from "../pages/TransfersPage";
import { ApprovalsPage } from "../pages/ApprovalsPage";
import { AuditPage } from "../pages/AuditPage";
import { PolicyRulesPage } from "../pages/PolicyRulesPage";
import { SecurityPage } from "../pages/SecurityPage";
import { OrgSnapshotPage } from "../pages/OrgSnapshotPage";
import { ComponentLabPage } from "../pages/ComponentLabPage";

function parseHash(): { path: string } {
  const hash = (typeof window !== "undefined" ? window.location.hash : "") || "#/";
  const stripped = hash.startsWith("#") ? hash.slice(1) : hash;
  const path = stripped || "/";
  return { path };
}

export const AdminRouter: FC = () => {
  const [route, setRoute] = useState(() => parseHash());

  useEffect(() => {
    const onChange = () => setRoute(parseHash());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  if (route.path === "/" || route.path === "") return <OverviewPage />;
  if (route.path === "/users") return <UsersPage />;
  if (route.path === "/devices") return <DevicesPage />;
  if (route.path === "/instances") return <AgentInstancesPage />;
  if (route.path === "/presence") return <PresencePage />;
  if (route.path === "/tasks") return <TasksPage />;
  if (route.path === "/transfers") return <TransfersPage />;
  if (route.path === "/approvals") return <ApprovalsPage />;
  if (route.path === "/audit") return <AuditPage />;
  if (route.path === "/policy") return <PolicyRulesPage />;
  if (route.path === "/security") return <SecurityPage />;
  if (route.path === "/components") return <ComponentLabPage />;
  if (route.path.startsWith("/orgs/")) {
    const id = decodeURIComponent(route.path.split("/").pop() ?? "");
    return <OrgSnapshotPage orgId={id} />;
  }
  return <NotFound />;
};

const NotFound: FC = () => (
  <div className="flex h-full items-center justify-center text-sm text-white/55">
    <div className="rounded-xl border border-white/10 bg-[#0b0b0d]/80 p-6 text-center">
      <p className="text-base font-semibold text-white">Page not found</p>
      <p className="mt-1 text-xs text-white/45">Try the sidebar on the left.</p>
    </div>
  </div>
);
