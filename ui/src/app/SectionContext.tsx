import { createContext, useContext } from "react";

export type AppSection = "inbox" | "chats" | "agents" | "approvals" | "files" | "tasks" | "audit" | "settings";

export const SectionContext = createContext<AppSection>("inbox");

export function useSection() {
  return useContext(SectionContext);
}

export const SECTION_LABELS: Record<AppSection, string> = {
  inbox: "Inbox",
  chats: "Chats",
  agents: "Agents",
  approvals: "Approvals",
  files: "Files",
  tasks: "Tasks",
  audit: "Audit",
  settings: "Settings",
};

export function inferSection(pathname: string): AppSection {
  const match = pathname.match(/^\/([^/]+)/);
  const key = match?.[1] ?? "inbox";
  if (
    key === "inbox" || key === "chats" || key === "agents" || key === "approvals" ||
    key === "files" || key === "tasks" || key === "audit" || key === "settings"
  ) {
    return key;
  }
  return "inbox";
}
