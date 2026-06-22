import { useLocation } from "react-router-dom";
import { Outlet } from "react-router-dom";
import { SidebarProvider } from "../components/SidebarContext";
import { SectionSidebar } from "./SectionSidebar";
import { SectionContext, inferSection } from "./SectionContext";
import { CommandPalette } from "../components/CommandPalette";
import { useDensityPreference } from "../lib/uiPreferences";
import { UserRail } from "./UserRail";
import { useRealtimePolling } from "../hooks/queries";
import { AnimatePresence, appShellVariants, m, motionTransition } from "../components/primitives/MotionPrimitives";
import { AppShellContentWatchdog } from "./AppShellContentWatchdog";
import { ErrorBoundary } from "./ErrorBoundary";

export function AppShell() {
  useRealtimePolling();
  const location = useLocation();
  const section = inferSection(location.pathname);
  const { density } = useDensityPreference();
  const routeMotionKey = location.pathname.split("/")[1] || "home";

  return (
    <SidebarProvider>
      <SectionContext.Provider value={section}>
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-oa-surface focus:px-4 focus:py-2 focus:text-sm focus:text-oa-text focus:shadow-lg"
        >
          Skip to content
        </a>
        <div className={`flex h-full w-full bg-oa-bg density-${density}`} data-density={density}>
          <UserRail />
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex min-h-0 flex-1 overflow-hidden">
              <SectionSidebar />
              <main id="main-content" className="flex min-h-0 flex-1" role="main" aria-label="Main content">
                <AnimatePresence initial={false} mode="popLayout">
                  <m.div
                    key={routeMotionKey}
                    data-app-route-content
                    className="flex min-h-0 flex-1"
                    variants={appShellVariants}
                    initial="initial"
                    animate="animate"
                    exit="exit"
                    transition={motionTransition.quick}
                  >
                    <ErrorBoundary
                      key={location.pathname}
                      title="This page could not render"
                      description="The app shell is still running, but the current page hit a rendering error."
                      className="flex min-h-0 flex-1 items-center justify-center bg-oa-bg p-6 text-oa-text"
                      sentryContext={{ pathname: location.pathname, section }}
                    >
                      <AppShellContentWatchdog section={section}>
                        <Outlet />
                      </AppShellContentWatchdog>
                    </ErrorBoundary>
                  </m.div>
                </AnimatePresence>
              </main>
            </div>
          </div>
        </div>
        <CommandPalette />
      </SectionContext.Provider>
    </SidebarProvider>
  );
}
