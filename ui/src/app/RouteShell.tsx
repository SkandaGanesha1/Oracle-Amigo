import { Outlet } from "react-router-dom";

export function RouteShell() {
  return (
    <div className="flex h-full w-full flex-col bg-oa-bg">
      <main
        className="min-h-0 flex-1 overflow-y-auto"
        role="main"
        aria-label="Authentication and enrollment"
        data-testid="auth-route-scroll"
      >
        <Outlet />
      </main>
    </div>
  );
}
