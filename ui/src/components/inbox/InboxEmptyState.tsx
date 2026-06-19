import { CheckCircle2 } from "lucide-react";
import type { ReactNode } from "react";

export function InboxEmptyState({
  title = "All clear",
  message = "No approvals or risky transfers need attention. Recent completed work is available from the Completed bucket.",
  action
}: {
  title?: string;
  message?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-[320px] flex-col items-center justify-center px-6 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-oa-border bg-oa-surface-2 text-oa-green">
        <CheckCircle2 className="h-6 w-6" />
      </div>
      <h2 className="mt-4 text-lg font-semibold text-oa-text">{title}</h2>
      <p className="mt-1 max-w-xs text-sm text-oa-text-muted">{message}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
