import type { ReactNode } from "react";

export function InboxShell({ children, detailOpen = true }: { children: ReactNode; detailOpen?: boolean }) {
  return (
    <section className="oa-inbox-shell min-h-0 h-full w-full bg-oa-bg" data-detail-open={detailOpen ? "true" : "false"}>
      {children}
    </section>
  );
}
