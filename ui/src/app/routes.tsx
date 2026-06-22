import { Navigate, Outlet, Route, Routes, useLocation, useParams } from "react-router-dom";
import { Home, LogIn, RefreshCw } from "lucide-react";
import { AppShell } from "./AppShell";
import { RouteShell } from "./RouteShell";
import { AuthScreen } from "../features/auth/AuthScreen";
import { DeviceEnrollmentScreen } from "../features/enrollment/DeviceEnrollmentScreen";
import { MainChatLayout } from "../features/chat/MainChatLayout";
import { InboxPage } from "../pages/InboxPage";
import { AgentsPage } from "../pages/AgentsPage";
import { ApprovalsPage } from "../pages/ApprovalsPage";
import { FilesPage } from "../pages/FilesPage";
import { TasksPage } from "../pages/TasksPage";
import { AuditPage } from "../pages/AuditPage";
import { SettingsPage } from "../pages/SettingsPage";
import { useCloudStatus } from "../hooks/queries";
import { isCloudUserSessionReady, useCloudUserSession } from "../api/cloudUserSessionStore";
import { useLocalUiSession } from "../api/localUiSessionStore";
import { AmigoLogoLoader } from "../features/loading/AmigoLogoLoader";

function ChatRedirect() {
  const params = useParams<{ conversationId?: string }>();
  return <Navigate to={params.conversationId ? `/chats/${params.conversationId}` : "/chats"} replace />;
}

function ProtectedRouteFallback() {
  const location = useLocation();
  return (
    <section className="flex min-h-0 flex-1 items-center justify-center bg-oa-bg p-6 text-oa-text" role="alert">
      <div className="w-full max-w-md rounded-lg border border-oa-border bg-oa-surface p-5 shadow-xl">
        <h1 className="text-base font-semibold text-oa-text">Page not found</h1>
        <p className="mt-1 text-sm text-oa-text-muted">
          No protected route is registered for <span className="font-mono text-xs text-oa-text">{location.pathname}</span>.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={() => window.location.assign("/inbox")} className="inline-flex min-h-[40px] items-center gap-2 rounded-md bg-oa-blue px-3 py-2 text-sm font-medium text-white hover:bg-oa-blue/90">
            <Home className="h-4 w-4" />
            Go to Inbox
          </button>
          <button type="button" onClick={() => window.location.assign("/login")} className="inline-flex min-h-[40px] items-center gap-2 rounded-md border border-oa-border bg-oa-bg-elevated px-3 py-2 text-sm font-medium text-oa-text hover:bg-oa-surface">
            <LogIn className="h-4 w-4" />
            Go to Login
          </button>
          <button type="button" onClick={() => window.location.reload()} className="inline-flex min-h-[40px] items-center gap-2 rounded-md border border-oa-border bg-oa-bg-elevated px-3 py-2 text-sm font-medium text-oa-text hover:bg-oa-surface">
            <RefreshCw className="h-4 w-4" />
            Reload
          </button>
        </div>
      </div>
    </section>
  );
}

function RouteGate() {
  const location = useLocation();
  const localSession = useLocalUiSession();
  const cloudSession = useCloudUserSession();
  const { data, isLoading, isError } = useCloudStatus();
  const cloud = data?.cloud;
  const status = cloud?.status ?? "disconnected";
  const hasActiveUserAuth = Boolean(cloud?.hasUserAccessToken && data?.userAuthIssue == null);
  const hasActiveDeviceAuth = Boolean(cloud?.hasDeviceAccessToken && data?.tokenIssue !== "expired");
  const cloudAuthMessage =
    cloudSession.message ??
    (data?.userAuthIssue === "expired"
      ? "Cloud login expired. Please sign in again."
      : data?.userAuthIssue === "required" || cloud?.hasUserAccessToken === false
        ? "Please sign in to continue."
        : null);

  if (localSession.status === "blocked" || cloudSession.status === "blocked") {
    return <Navigate to="/login" replace state={{ from: location.pathname, cloudAuthMessage }} />;
  }

  if (localSession.status === "checking" || localSession.status === "recovering" || isLoading || (hasActiveUserAuth && !isCloudUserSessionReady(cloudSession.status))) {
    return (
      <div className="oa-amigo-page-loader">
        <AmigoLogoLoader
          label={localSession.status === "recovering" ? "Refreshing local UI session..." : "Checking local agent status..."}
        />
      </div>
    );
  }

  if (isError || status === "disconnected" || !hasActiveUserAuth) {
    return <Navigate to="/login" replace state={{ from: location.pathname, cloudAuthMessage }} />;
  }

  if (status !== "enrolled" || !hasActiveDeviceAuth) {
    return <Navigate to="/enroll" replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}

function EnrollmentGate() {
  const cloudSession = useCloudUserSession();
  const { data, isLoading, isError } = useCloudStatus();
  const cloud = data?.cloud;
  const status = cloud?.status ?? "disconnected";
  const hasActiveUserAuth = Boolean(cloud?.hasUserAccessToken && data?.userAuthIssue == null);
  const hasActiveDeviceAuth = Boolean(cloud?.hasDeviceAccessToken && data?.tokenIssue !== "expired");
  const cloudAuthMessage =
    cloudSession.message ??
    (data?.userAuthIssue === "expired"
      ? "Cloud login expired. Please sign in again."
      : data?.userAuthIssue === "required" || cloud?.hasUserAccessToken === false
        ? "Please sign in to continue."
        : null);

  if (isLoading) {
    return (
      <div className="oa-amigo-page-loader">
        <AmigoLogoLoader label="Checking enrollment status..." />
      </div>
    );
  }

  if (cloudSession.status === "blocked" || isError || status === "disconnected" || !hasActiveUserAuth) {
    return <Navigate to="/login" replace state={{ cloudAuthMessage }} />;
  }
  if (status === "enrolled" && hasActiveDeviceAuth) return <Navigate to="/inbox" replace />;
  return <DeviceEnrollmentScreen />;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<RouteShell />}>
        <Route path="/signup" element={<AuthScreen />} />
        <Route path="/login" element={<AuthScreen />} />
        <Route path="/enroll" element={<EnrollmentGate />} />
      </Route>
      <Route element={<RouteGate />}>
        <Route element={<AppShell />}>
          <Route path="/chats" element={<MainChatLayout />} />
          <Route path="/chats/:conversationId" element={<MainChatLayout />} />
          <Route path="/chat/:conversationId" element={<ChatRedirect />} />
          <Route path="/chat" element={<ChatRedirect />} />
          <Route path="/agents" element={<AgentsPage />} />
          <Route path="/approvals" element={<ApprovalsPage />} />
          <Route path="/files" element={<FilesPage />} />
          <Route path="/tasks" element={<TasksPage />} />
          <Route path="/audit" element={<AuditPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/inbox" element={<InboxPage />} />
          <Route path="/" element={<Navigate to="/inbox" replace />} />
          <Route path="*" element={<ProtectedRouteFallback />} />
        </Route>
      </Route>
    </Routes>
  );
}
