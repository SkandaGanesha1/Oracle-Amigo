// Sidebar state shared between CommandBar toggle and MainChatLayout
import { createContext, useCallback, useContext, useEffect, useState, type PropsWithChildren } from "react";

const SIDEBAR_STORAGE_KEY = "agentic-chat-sidebar-open";

type SidebarContextValue = {
  sidebarOpen: boolean;
  openSidebar: () => void;
  closeSidebar: () => void;
  toggleSidebar: () => void;
};

const SidebarContext = createContext<SidebarContextValue | undefined>(undefined);

export function useSidebar() {
  const value = useContext(SidebarContext);
  if (!value) {
    throw new Error("useSidebar must be used within a SidebarProvider");
  }
  return value;
}

export function SidebarProvider({
  children,
  initialOpen = true
}: PropsWithChildren<{ initialOpen?: boolean }>) {
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window === "undefined") return initialOpen;
    const stored = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);
    return stored === null ? initialOpen : stored === "true";
  });

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(sidebarOpen));
  }, [sidebarOpen]);

  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  return (
    <SidebarContext.Provider value={{ closeSidebar, openSidebar: () => setSidebarOpen(true), sidebarOpen, toggleSidebar: () => setSidebarOpen((v) => !v) }}>
      {children}
    </SidebarContext.Provider>
  );
}
