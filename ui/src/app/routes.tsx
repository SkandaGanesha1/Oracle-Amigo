import { Navigate, Outlet, Route, Routes, useLocation, useParams } from "react-router-dom";
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

function ChatRedirect() {
  const params = useParams<{ conversationId?: string }>();
  return <Navigate to={params.conversationId ? `/chats/${params.conversationId}` : "/chats"} replace />;
}

function RouteGate() {
  const location = useLocation();
  const { data, isLoading, isError } = useCloudStatus();
  const cloud = data?.cloud;
  const status = cloud?.status ?? "disconnected";

  if (isLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-oa-bg text-sm text-oa-text-muted">
        Checking local agent status...
      </div>
    );
  }

  if (isError || status === "disconnected") {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (status !== "enrolled" || !cloud?.hasDeviceAccessToken || data?.tokenIssue === "expired") {
    return <Navigate to="/enroll" replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}

function EnrollmentGate() {
  const { data, isLoading, isError } = useCloudStatus();
  const cloud = data?.cloud;
  const status = cloud?.status ?? "disconnected";

  if (isLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-oa-bg text-sm text-oa-text-muted">
        Checking enrollment status...
      </div>
    );
  }

  if (isError || status === "disconnected") return <Navigate to="/login" replace />;
  if (status === "enrolled" && cloud?.hasDeviceAccessToken && data?.tokenIssue !== "expired") return <Navigate to="/inbox" replace />;
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
        </Route>
      </Route>
    </Routes>
  );
}
