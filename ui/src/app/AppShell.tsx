import { useLocation } from "react-router-dom";
import { Outlet } from "react-router-dom";
import { SidebarProvider } from "../components/SidebarContext";
import { NavBar } from "./NavBar";
import { SectionSidebar } from "./SectionSidebar";
import { SectionContext, inferSection } from "./SectionContext";
import { CommandPalette } from "../components/CommandPalette";
import { useDensityPreference } from "../lib/uiPreferences";
import { UserRail } from "./UserRail";

export function AppShell() {
  const location = useLocation();
  const section = inferSection(location.pathname);
  const { density } = useDensityPreference();

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
            <NavBar />
            <div className="flex min-h-0 flex-1 overflow-hidden">
              <SectionSidebar />
              <main id="main-content" className="flex min-h-0 flex-1" role="main" aria-label="Main content">
                <Outlet />
              </main>
            </div>
          </div>
        </div>
        <CommandPalette />
      </SectionContext.Provider>
    </SidebarProvider>
  );
}
