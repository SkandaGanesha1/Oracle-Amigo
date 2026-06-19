import Fuse from "fuse.js";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  Search, MessageSquareText, Bot, ShieldCheck, FileText, ListChecks,
  ScrollText, Settings, Command, ArrowRight, Inbox, Bell, ShieldAlert
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useUniversalSearch } from "../hooks/queries";
import type { UniversalSearchResult, UniversalSearchResultType } from "../api/types";
import { AnimatePresence, m, modalPanelVariants, motionTransition, overlayVariants } from "./primitives/MotionPrimitives";

interface CommandEntry {
  id: string;
  label: string;
  description: string;
  icon: typeof Search;
  category: string;
  action: () => void;
}

type PaletteEntry = CommandEntry | {
  id: string;
  label: string;
  description: string;
  icon: typeof Search;
  category: string;
  type: UniversalSearchResultType;
  score: number;
  action: () => void;
};

const resultIcon: Record<UniversalSearchResultType, typeof Search> = {
  conversation: MessageSquareText,
  agent: Bot,
  file: FileText,
  mission: ListChecks,
  approval: ShieldCheck,
  transfer: ArrowRight,
  audit: ScrollText,
  setting: Settings,
  policy: ShieldAlert,
};

const resultCategory: Record<UniversalSearchResultType, string> = {
  conversation: "Conversations",
  agent: "Agents",
  file: "Files",
  mission: "Missions",
  approval: "Approvals",
  transfer: "Transfers",
  audit: "Audit",
  setting: "Settings",
  policy: "Policy",
};

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const searchQuery = query.trim();
  const universal = useUniversalSearch(searchQuery, open && searchQuery.length >= 2);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
        setQuery("");
        setSelectedIndex(0);
      }
      if (e.key === "Escape" && open) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
  }, []);

  const commands: CommandEntry[] = useMemo(() => [
    { id: "go-inbox", label: "Go to Inbox", description: "Open actionable intent inbox", icon: Inbox, category: "Navigation", action: () => { navigate("/inbox"); close(); } },
    { id: "go-chats", label: "Go to Chats", description: "Open conversations", icon: MessageSquareText, category: "Navigation", action: () => { navigate("/chats"); close(); } },
    { id: "go-agents", label: "Go to Agents", description: "View connected agents", icon: Bot, category: "Navigation", action: () => { navigate("/agents"); close(); } },
    { id: "go-approvals", label: "Go to Approvals", description: "Pending file requests", icon: ShieldCheck, category: "Navigation", action: () => { navigate("/approvals"); close(); } },
    { id: "go-files", label: "Go to Vault", description: "Stored files and indexed roots", icon: FileText, category: "Navigation", action: () => { navigate("/files"); close(); } },
    { id: "go-tasks", label: "Go to Missions", description: "Agent task history", icon: ListChecks, category: "Navigation", action: () => { navigate("/tasks"); close(); } },
    { id: "go-audit", label: "Go to Audit", description: "Event log", icon: ScrollText, category: "Navigation", action: () => { navigate("/audit"); close(); } },
    { id: "go-settings", label: "Go to Settings", description: "Configure Oracle Amigo", icon: Settings, category: "Navigation", action: () => { navigate("/settings"); close(); } },
    { id: "show-notifications", label: "Open Notifications", description: "Review approvals, transfers, policy, and mission events", icon: Bell, category: "Actions", action: () => {
      close();
      setTimeout(() => window.dispatchEvent(new CustomEvent("oa-open-notifications")), 50);
    }},
    { id: "search-directory", label: "Search Directory", description: "Find users to chat with", icon: Search, action: () => {
      close();
      setTimeout(() => window.dispatchEvent(new CustomEvent("oa-focus-directory-search")), 50);
    }, category: "Actions" },
  ], [close, navigate]);

  const filteredCommands = useMemo(() => {
    if (!searchQuery) return commands;
    const fuse = new Fuse(commands, {
      keys: ["label", "description", "category"],
      threshold: 0.35,
      ignoreLocation: true,
    });
    return fuse.search(searchQuery).map((result) => result.item);
  }, [commands, searchQuery]);

  const backendEntries = useMemo<PaletteEntry[]>(() => {
    const results = (universal.data?.results ?? []) as UniversalSearchResult[];
    return results.map((result) => {
      const Icon = resultIcon[result.type] ?? Search;
      return {
        id: `search-${result.type}-${result.id}`,
        label: result.title,
        description: result.snippet || result.subtitle,
        icon: Icon,
        category: resultCategory[result.type] ?? "Results",
        type: result.type,
        score: result.score,
        action: () => {
          navigate(result.route || "/inbox");
          close();
        },
      };
    });
  }, [close, navigate, universal.data]);

  const filtered: PaletteEntry[] = searchQuery
    ? [...backendEntries, ...filteredCommands].slice(0, 40)
    : filteredCommands;

  const grouped = filtered.reduce<Array<{ category: string; items: PaletteEntry[] }>>((acc, item) => {
    const current = acc.find((group) => group.category === item.category);
    if (current) current.items.push(item);
    else acc.push({ category: item.category, items: [item] });
    return acc;
  }, []);

  return (
    <AnimatePresence>
    {open && (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh]"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <m.div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm"
        onClick={close}
        variants={overlayVariants}
        initial="initial"
        animate="animate"
        exit="exit"
        transition={motionTransition.quick}
      />
      <m.div
        variants={modalPanelVariants}
        initial="initial"
        animate="animate"
        exit="exit"
        transition={motionTransition.quick}
        className="glass-panel-strong relative flex w-full max-w-lg flex-col overflow-hidden rounded-xl"
      >
        <div className="flex items-center gap-3 border-b border-oa-border px-4 py-3">
          <Search className="h-4 w-4 shrink-0 text-oa-text-muted" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.currentTarget.value);
              setSelectedIndex(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSelectedIndex((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter" && filtered[selectedIndex]) {
                e.preventDefault();
                filtered[selectedIndex].action();
              } else if (e.key === "Escape") {
                close();
              }
            }}
            placeholder="Search messages, agents, files, missions, policy..."
            className="flex-1 bg-transparent text-sm text-oa-text placeholder-oa-text-disabled outline-none"
            aria-label="Command search"
          />
          <kbd className="hidden shrink-0 items-center gap-0.5 rounded border border-oa-border bg-oa-bg px-1.5 py-0.5 text-[9px] text-oa-text-muted sm:flex">
            <Command className="h-2.5 w-2.5" />
            K
          </kbd>
        </div>

        <div className="max-h-80 overflow-y-auto p-2" role="listbox" aria-label="Commands">
          {filtered.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-oa-text-muted">
              {universal.isFetching ? "Searching Oracle Amigo..." : `No results for "${query}"`}
            </div>
          ) : (
            grouped.map((group) => {
              let offset = 0;
              for (const prior of grouped) {
                if (prior === group) break;
                offset += prior.items.length;
              }
              return (
                <div key={group.category} className="mb-1">
                  <div className="px-3 pb-1 pt-2 text-[9px] font-semibold uppercase tracking-wider text-oa-text-disabled">
                    {group.category}
                  </div>
                  {group.items.map((cmd, localIndex) => {
                    const i = offset + localIndex;
                    const Icon = cmd.icon;
                    return (
                      <button
                        key={cmd.id}
                        type="button"
                        role="option"
                        aria-selected={i === selectedIndex}
                        onClick={cmd.action}
                        onMouseEnter={() => setSelectedIndex(i)}
                        className={`flex min-h-[48px] w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-oa-blue ${
                          i === selectedIndex ? "bg-oa-blue/20 text-oa-blue" : "text-oa-text hover:bg-oa-surface"
                        }`}
                      >
                        <Icon className="h-4 w-4 shrink-0" />
                        <div className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate font-medium">{cmd.label}</span>
                          <span className="truncate text-[10px] text-oa-text-muted">{cmd.description}</span>
                        </div>
                        <ArrowRight className={`h-3.5 w-3.5 shrink-0 ${i === selectedIndex ? "text-oa-blue" : "text-oa-text-muted"}`} />
                      </button>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>

        <div className="border-t border-oa-border px-4 py-2">
          <div className="flex items-center gap-4 text-[9px] text-oa-text-muted">
            <span><kbd className="rounded border border-oa-border bg-oa-bg px-1 py-0.5">Up/Down</kbd> Navigate</span>
            <span><kbd className="rounded border border-oa-border bg-oa-bg px-1 py-0.5">Enter</kbd> Open</span>
            <span><kbd className="rounded border border-oa-border bg-oa-bg px-1 py-0.5">Esc</kbd> Close</span>
          </div>
        </div>
      </m.div>
    </div>
    )}
    </AnimatePresence>
  );
}
