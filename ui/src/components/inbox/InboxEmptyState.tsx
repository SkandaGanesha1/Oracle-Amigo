import { CheckCircle2 } from "lucide-react";

export function InboxEmptyState() {
  return (
    <div className="flex h-full min-h-[320px] flex-col items-center justify-center px-6 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-oa-border bg-oa-surface-2 text-oa-green">
        <CheckCircle2 className="h-6 w-6" />
      </div>
      <h2 className="mt-4 text-lg font-semibold text-oa-text">All clear</h2>
      <p className="mt-1 max-w-xs text-sm text-oa-text-muted">
        No approvals or risky transfers need attention. Recent completed work is available from the Completed bucket.
      </p>
    </div>
  );
}
