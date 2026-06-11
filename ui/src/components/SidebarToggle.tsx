import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { cn } from "~/lib/utils";
import { useSidebar } from "./SidebarContext";

type SidebarToggleProps = {
  className?: string;
};

export function SidebarToggle({ className }: SidebarToggleProps) {
  const { sidebarOpen, toggleSidebar } = useSidebar();
  const Icon = sidebarOpen ? PanelLeftClose : PanelLeftOpen;

  return (
    <button
      type="button"
      aria-label={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
      className={cn("flex min-h-[48px] min-w-[48px] items-center justify-center rounded-lg text-oa-text-muted transition-colors hover:bg-oa-surface hover:text-oa-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue focus-visible:ring-offset-2", className)}
      onClick={toggleSidebar}
      title={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
    >
      <Icon aria-hidden="true" className="h-4 w-4" />
    </button>
  );
}
