import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import {
  Bot, ShieldCheck, FileText,
  ListChecks, ScrollText,
} from "lucide-react";
import { useSection, type AppSection } from "./SectionContext";
import { NotificationCenter } from "../components/notifications/NotificationCenter";

const sections: { id: AppSection; label: string; icon: typeof Bot }[] = [
  { id: "agents", label: "Agents", icon: Bot },
  { id: "approvals", label: "Approvals", icon: ShieldCheck },
  { id: "files", label: "Vault", icon: FileText },
  { id: "tasks", label: "Missions", icon: ListChecks },
  { id: "audit", label: "Audit", icon: ScrollText },
];

export function NavBar() {
  const section = useSection();
  const navigate = useNavigate();

  return (
    <header className="glass-panel-strong flex h-14 shrink-0 items-center gap-1 border-x-0 border-t-0 bg-[#1e1f22]/90 px-4">
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
        <NotificationCenter />
      </div>
    </header>
  );
}
