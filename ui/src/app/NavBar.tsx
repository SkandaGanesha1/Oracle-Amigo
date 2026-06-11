import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import {
  Bot, Inbox, MessageSquareText, ShieldCheck, FileText,
  ListChecks, ScrollText, Settings,
} from "lucide-react";
import { useCloudStatus } from "../hooks/queries";
import { useSection, type AppSection } from "./SectionContext";
import { LogoutButton } from "../features/auth/LogoutButton";
import { NotificationCenter } from "../components/notifications/NotificationCenter";

const sections: { id: AppSection; label: string; icon: typeof Bot }[] = [
  { id: "inbox", label: "Inbox", icon: Inbox },
  { id: "chats", label: "Chats", icon: MessageSquareText },
  { id: "agents", label: "Agents", icon: Bot },
  { id: "approvals", label: "Approvals", icon: ShieldCheck },
  { id: "files", label: "Vault", icon: FileText },
  { id: "tasks", label: "Missions", icon: ListChecks },
  { id: "audit", label: "Audit", icon: ScrollText },
  { id: "settings", label: "Settings", icon: Settings },
];

export function NavBar() {
  const section = useSection();
  const navigate = useNavigate();
  const { data: cloudStatus } = useCloudStatus();

  const status = cloudStatus?.tokenIssue === "expired" ? "authenticated" : cloudStatus?.cloud?.status ?? "disconnected";
  const userLabel = cloudStatus?.cloud?.displayName ?? cloudStatus?.cloud?.userEmail ?? "Local session";
  const dotColor =
    status === "enrolled" ? "bg-oa-green"
    : status === "authenticated" ? "bg-oa-amber"
    : "bg-oa-red";

  return (
    <header className="glass-panel-strong flex h-14 shrink-0 items-center gap-1 border-x-0 border-t-0 px-4">
      <div className="flex items-center gap-2 mr-4">
        <span className="brand-mark flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-oa-blue via-oa-purple to-oa-cyan">
          <Bot className="h-4 w-4 text-white" />
        </span>
        <span className="text-sm font-semibold text-oa-text tracking-wide">Oracle Amigo</span>
      </div>

      <nav className="flex items-center gap-1" aria-label="Primary navigation">
        {sections.map((s) => {
          const Icon = s.icon;
          const isActive = section === s.id;
          return (
            <motion.button
              key={s.id}
              layout
              type="button"
              onClick={() => navigate(`/${s.id}`)}
              aria-current={isActive ? "page" : undefined}
              className={`relative flex min-h-[48px] items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue focus-visible:ring-offset-2 ${
                isActive
                  ? "text-oa-text"
                  : "text-oa-text-muted hover:text-oa-text hover:bg-oa-surface/40"
              }`}
            >
              {isActive && (
                <motion.span
                  layoutId="active-nav-pill"
                  className="absolute inset-1 rounded-md border border-oa-border-strong bg-oa-surface/80 shadow-[0_8px_24px_rgba(0,0,0,0.22)]"
                  transition={{ duration: 0.18 }}
                />
              )}
              <span className="relative flex items-center gap-1.5">
              <Icon className="h-3.5 w-3.5" />
              <span>{s.label}</span>
              </span>
            </motion.button>
          );
        })}
      </nav>

      <div className="ml-auto flex items-center gap-3">
        <span className="hidden max-w-[160px] truncate text-xs font-medium text-oa-text-secondary lg:inline" title={userLabel}>
          {userLabel}
        </span>
        <span className={`h-2.5 w-2.5 rounded-full ${dotColor} ring-4 ring-current/10`} title={`Connection: ${status}`} />
        <NotificationCenter />
        <LogoutButton />
      </div>
    </header>
  );
}
