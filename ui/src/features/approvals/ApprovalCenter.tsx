import { usePendingApprovals } from "../../hooks/queries";
import { ApprovalCard } from "./ApprovalCard";
import { Shield, Inbox } from "lucide-react";

export function ApprovalCenter() {
  const { approvalCards, isLoading } = usePendingApprovals();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="flex flex-col items-center gap-2">
          <div className="flex gap-1">
            <span className="h-2 w-2 animate-bounce rounded-full bg-oa-text-muted" style={{ animationDelay: "0ms" }} />
            <span className="h-2 w-2 animate-bounce rounded-full bg-oa-text-muted" style={{ animationDelay: "150ms" }} />
            <span className="h-2 w-2 animate-bounce rounded-full bg-oa-text-muted" style={{ animationDelay: "300ms" }} />
          </div>
          <p className="text-xs text-oa-text-muted">Loading approvals...</p>
        </div>
      </div>
    );
  }

  if (approvalCards.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-oa-surface ring-1 ring-oa-border">
          <Shield className="h-6 w-6 text-oa-text-muted" />
        </div>
        <p className="text-sm font-medium text-oa-text-muted">No pending approvals</p>
        <p className="text-xs text-oa-text-disabled text-center max-w-[240px]">
          When another agent requests a file, approval requests will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 px-1">
        <Inbox className="h-4 w-4 text-oa-amber" />
        <h2 className="text-sm font-semibold text-oa-text">
          Pending Approvals
        </h2>
        <span className="rounded-full bg-oa-amber/10 px-2 py-0.5 text-[10px] font-medium text-oa-amber">
          {approvalCards.length}
        </span>
      </div>
      <div className="space-y-3">
        {approvalCards.map((card) => (
          <ApprovalCard key={card.approval_id} card={card} />
        ))}
      </div>
    </div>
  );
}
