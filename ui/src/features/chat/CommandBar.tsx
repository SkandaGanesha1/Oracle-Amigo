import { Bot } from "lucide-react";
import { SidebarToggle } from "../../components/SidebarToggle";

export function CommandBar() {
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-oa-border bg-oa-sidebar-bg px-3">
      <div className="flex items-center gap-2">
        <SidebarToggle />
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-oa-blue to-oa-purple">
          <Bot className="h-4 w-4 text-white" />
        </span>
        <span className="text-sm font-semibold text-oa-text">
          Oracle Amigo
        </span>
      </div>
    </header>
  );
}
