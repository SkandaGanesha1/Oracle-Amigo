import { ShieldCheck, Clock3, AlertTriangle, FileText, Users } from "lucide-react";
import type { ActionableInboxItem } from "../../types/agentic";

export function RightConsentPanel({ selectedItem }: { selectedItem: ActionableInboxItem | null }) {
  if (!selectedItem) {
    return <aside className="rounded-2xl border border-oa-border bg-oa-surface p-4 text-sm text-oa-text-muted">Select an item to see requester, trust, and policy context.</aside>;
  }

  return (
    <aside className="rounded-2xl border border-oa-border bg-oa-surface p-4 shadow-sm">
      <p className="text-[11px] uppercase tracking-[0.2em] text-oa-text-muted">Context</p>
      <h3 className="mt-1 text-base font-semibold text-oa-text">{selectedItem.title}</h3>
      <p className="mt-1 text-sm text-oa-text-muted">{selectedItem.summary}</p>
      <div className="mt-4 space-y-3 text-sm text-oa-text-muted">
        <div className="rounded-xl border border-oa-border bg-oa-bg-elevated p-3"><div className="flex items-center gap-2"><Users className="h-4 w-4 text-oa-blue" />Requester</div><p className="mt-1 text-oa-text">{selectedItem.requester?.name ?? "Remote requester"}</p></div>
        <div className="rounded-xl border border-oa-border bg-oa-bg-elevated p-3"><div className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-oa-green" />Trust</div><p className="mt-1 text-oa-text">{selectedItem.trustBadge.label}</p></div>
        <div className="rounded-xl border border-oa-border bg-oa-bg-elevated p-3"><div className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-oa-amber" />Risk</div><p className="mt-1 text-oa-text">{selectedItem.risk} risk, {selectedItem.sensitivity} sensitivity</p></div>
        <div className="rounded-xl border border-oa-border bg-oa-bg-elevated p-3"><div className="flex items-center gap-2"><FileText className="h-4 w-4 text-oa-purple" />Audit</div><p className="mt-1 text-oa-text">{selectedItem.auditPreview ?? "Audit preview available"}</p></div>
        <div className="rounded-xl border border-oa-border bg-oa-bg-elevated p-3"><div className="flex items-center gap-2"><Clock3 className="h-4 w-4 text-oa-text-muted" />Expiry</div><p className="mt-1 text-oa-text">{selectedItem.expiresAt ? new Date(selectedItem.expiresAt).toLocaleString() : "No expiry set"}</p></div>
      </div>
    </aside>
  );
}
