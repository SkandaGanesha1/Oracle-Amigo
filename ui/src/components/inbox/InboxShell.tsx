import type { ReactNode } from "react";

export function InboxShell({ children }: { children: ReactNode }) {
  return <section className="oa-inbox-shell min-h-0 h-full w-full bg-oa-bg">{children}</section>;
}
