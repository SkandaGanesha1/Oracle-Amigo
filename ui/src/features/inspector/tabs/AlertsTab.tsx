import { useState, useMemo } from "react";
import { usePendingApprovals, useApproveFileRequest } from "../../../hooks/queries";
import { Loader2, AlertTriangle, CheckCircle2, XCircle, Clock, Hourglass, MessageSquare, ArrowUpDown, Info, Check, Archive } from "lucide-react";

const AGENT_ID_RE = /^ag[ei]_[a-f0-9-]{36,}$/i;

function formatRequester(id: string): string {
  if (AGENT_ID_RE.test(id.trim())) return "Remote agent";
  return id;
}

const statusIcons: Record<string, typeof AlertTriangle> = {
  pending: Hourglass,
  approved: CheckCircle2,
  rejected: XCircle,
  feedback_requested: MessageSquare,
  feedback_received: MessageSquare,
  expired: Clock,
  feedback: MessageSquare
};

const statusColors: Record<string, string> = {
  pending: "text-oa-amber",
  approved: "text-oa-green",
  rejected: "text-oa-red",
  feedback_requested: "text-oa-blue",
  feedback_received: "text-oa-blue",
  expired: "text-oa-text-disabled",
  feedback: "text-oa-purple"
};

function estimateRiskType(requestText: string): { severity: "low" | "medium" | "high" } {
  const lower = requestText.toLowerCase();
  if (lower.includes("exe") || lower.includes("script") || lower.includes("binary")) return { severity: "high" };
  if (lower.includes("doc") || lower.includes("zip") || lower.includes("pdf")) return { severity: "medium" };
  return { severity: "low" };
}

export function AlertsTab() {
  const { approvalCards, isLoading } = usePendingApprovals();
  const { mutate: approve } = useApproveFileRequest();
  const [searchFilter, setSearchFilter] = useState("");
  const [showWhy, setShowWhy] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest">("newest");

  const { sorted, expiredSorted } = useMemo(() => {
    let result = approvalCards;
    if (searchFilter.trim()) {
      const q = searchFilter.toLowerCase();
      result = result.filter((c) =>
        c.request_text.toLowerCase().includes(q) || formatRequester(c.requester).toLowerCase().includes(q)
      );
    }
    const now = Date.now();
    const active = result.filter((c) => c.status === "pending" && new Date(c.expires_at).getTime() > now);
    const expired = result.filter((c) => c.status === "expired" || (c.status === "pending" && new Date(c.expires_at).getTime() <= now));
    const sorter = (a: { expires_at: string }, b: { expires_at: string }) => {
      const diff = new Date(a.expires_at).getTime() - new Date(b.expires_at).getTime();
      return sortOrder === "newest" ? -diff : diff;
    };
    return {
      sorted: [...active].sort(sorter),
      expiredSorted: [...expired].sort((a, b) => new Date(b.expires_at).getTime() - new Date(a.expires_at).getTime())
    };
  }, [approvalCards, searchFilter, sortOrder]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-oa-text-muted" />
      </div>
    );
  }

  if (approvalCards.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-4 py-8 text-center">
        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-oa-surface ring-1 ring-oa-border">
          <AlertTriangle className="h-5 w-5 text-oa-text-muted" />
        </div>
        <h3 className="text-sm font-medium text-oa-text-muted">Alerts</h3>
        <p className="mt-1 text-xs text-oa-text-disabled">No pending alerts</p>
      </div>
    );
  }

  const pendingCount = sorted.length;
  const lowRiskPending = sorted.filter((a) => estimateRiskType(a.request_text).severity === "low");
  const lowRiskIds = lowRiskPending.map((a) => a.approval_id);
  const hasExpired = expiredSorted.length > 0;

  function handleBulkApproveLow() {
    for (const id of lowRiskIds) approve({ approvalId: id });
  }

  function renderCard(card: typeof approvalCards[0]) {
    const Icon = statusIcons[card.status] ?? AlertTriangle;
    const color = statusColors[card.status] ?? "text-oa-text-muted";
    const now = new Date();
    const isActuallyExpired = card.status === "expired" || new Date(card.expires_at) < now;
    const risk = estimateRiskType(card.request_text);
    const showWhyId = `why-${card.approval_id}`;

    return (
      <div
        key={card.approval_id}
        className={`rounded-md bg-oa-surface px-2.5 py-2 ring-1 ${isActuallyExpired ? "ring-oa-border/20 opacity-70" : "ring-oa-border/50"}`}
      >
        <div className="flex items-start gap-2.5">
          <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${color}`} />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-[11px] font-medium text-oa-text">
                {card.request_text}
              </span>
              <div className="flex items-center gap-1 shrink-0">
                {risk.severity === "high" && <span className="rounded bg-oa-red/20 px-1 py-0.5 text-[8px] font-bold text-oa-red uppercase">High</span>}
                {risk.severity === "medium" && <span className="rounded bg-oa-amber/20 px-1 py-0.5 text-[8px] font-bold text-oa-amber uppercase">Med</span>}
                <span className={`rounded px-1 py-0.5 text-[9px] font-medium uppercase ${isActuallyExpired ? "bg-oa-surface-2 text-oa-text-disabled" : "bg-oa-amber/20 text-oa-amber"}`}>
                  {isActuallyExpired ? "Expired" : card.status}
                </span>
              </div>
            </div>
            <span className="truncate text-[10px] text-oa-text-muted">
              From: {formatRequester(card.requester)}
            </span>
            {card.candidates.length > 0 && (
              <span className="text-[10px] text-oa-text-muted">
                {card.candidates.length} file{card.candidates.length !== 1 ? "s" : ""}
              </span>
            )}
            {card.feedback_text && (
              <span className="mt-0.5 text-[10px] italic text-oa-text-muted">
                "{card.feedback_text}"
              </span>
            )}
            <div className="flex items-center gap-2 mt-1">
              <button
                type="button"
                onClick={() => setShowWhy(showWhyId === showWhy ? null : showWhyId)}
                className="flex items-center gap-1 text-[9px] text-oa-text-muted hover:text-oa-text transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue focus-visible:ring-offset-2"
              >
                <Info className="h-3 w-3" />
                {showWhy === showWhyId ? "Hide details" : isActuallyExpired ? "Why was this?" : "Why am I seeing this?"}
              </button>
            </div>
            {showWhy === showWhyId && (
              <div className="mt-1 rounded bg-oa-surface-2 px-2 py-1.5 text-[9px] text-oa-text-muted leading-relaxed">
                {isActuallyExpired
                  ? `This request from ${formatRequester(card.requester)} expired before a decision was made. No files were shared.`
                  : `${formatRequester(card.requester)} requested access to ${card.candidates.length} file${card.candidates.length !== 1 ? "s" : ""} matching "${card.request_text}". This requires your approval because the file is on your device and will be shared externally.`
                }
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-oa-text-muted">
          Alerts
        </h3>
        {pendingCount > 0 && (
          <span className="rounded-full bg-oa-amber/20 px-1.5 py-0.5 text-[10px] font-medium text-oa-amber">
            {pendingCount} pending
          </span>
        )}
        {pendingCount === 0 && hasExpired && (
          <span className="rounded-full bg-oa-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-oa-text-disabled">
            {expiredSorted.length} expired
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        <input
          type="text"
          value={searchFilter}
          onChange={(e) => setSearchFilter(e.target.value)}
          placeholder="Search alerts..."
          className="flex-1 rounded-md border border-oa-border bg-oa-surface px-2 py-1 text-[10px] text-oa-text placeholder-oa-text-disabled outline-none focus:border-oa-blue"
        />
        <button
          type="button"
          onClick={() => setSortOrder(sortOrder === "newest" ? "oldest" : "newest")}
          className="flex min-h-[48px] items-center gap-1 rounded-md bg-oa-surface px-2 py-1 text-[10px] text-oa-text-muted hover:text-oa-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue focus-visible:ring-offset-2"
          title="Toggle sort order"
        >
          <ArrowUpDown className="h-3 w-3" />
          {sortOrder}
        </button>
      </div>

      {lowRiskPending.length > 1 && (
        <div className="flex items-center gap-2 rounded-md bg-oa-green/5 border border-oa-green/20 px-3 py-2">
          <span className="text-[10px] text-oa-text-muted flex-1">{lowRiskPending.length} low-risk approvals pending — approve all?</span>
          <button
            type="button"
            onClick={handleBulkApproveLow}
            className="flex min-h-[48px] items-center gap-1 px-2 text-[10px] text-oa-green underline hover:text-oa-green/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue focus-visible:ring-offset-2"
          >
            <Check className="h-3 w-3" /> Approve all
          </button>
        </div>
      )}

      {sorted.length > 0 && (
        <div className="space-y-1.5" role="list" aria-label="Pending alerts" aria-live="polite">
          {sorted.map(renderCard)}
        </div>
      )}

      {hasExpired && (
        <>
          <div className="flex items-center gap-2 pt-1">
            <Archive className="h-3 w-3 text-oa-text-disabled" />
            <span className="text-[10px] font-medium uppercase tracking-wider text-oa-text-disabled">
              Expired ({expiredSorted.length})
            </span>
          </div>
          <div className="space-y-1.5" role="list" aria-label="Expired alerts">
            {expiredSorted.map(renderCard)}
          </div>
        </>
      )}
    </div>
  );
}
