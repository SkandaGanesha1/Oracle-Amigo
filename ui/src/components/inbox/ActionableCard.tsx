import { motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, Eye, ShieldAlert } from "lucide-react";
import type { ActionableInboxItem } from "../../types/agentic";

export function ActionableCard({ item, onAction }: { item: ActionableInboxItem; onAction: (action: string, itemId: string) => void }) {
  return (
    <motion.article
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-oa-border bg-oa-surface p-4 shadow-sm"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.2em] text-oa-text-muted">{item.type}</p>
          <h3 className="mt-1 text-base font-semibold text-oa-text">{item.title}</h3>
          <p className="mt-1 text-sm text-oa-text-muted">{item.summary}</p>
        </div>
        <span className="rounded-full bg-oa-amber/10 px-2 py-1 text-[10px] font-semibold text-oa-amber">{item.risk}</span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-[10px] text-oa-text-muted">
        <span className="rounded-full bg-oa-blue/10 px-2 py-1">Sensitivity: {item.sensitivity}</span>
        <span className="rounded-full bg-oa-green/10 px-2 py-1">Trust: {item.trustBadge.label}</span>
        {item.isLeavingDevice && <span className="rounded-full bg-oa-amber/10 px-2 py-1">Leaves device</span>}
      </div>
      {item.progress && (
        <div className="mt-3 rounded-xl border border-oa-border bg-oa-bg-elevated p-3">
          <div className="flex items-center justify-between text-[11px] text-oa-text-muted"><span>Progress</span><strong>{item.progress.percentage}%</strong></div>
          <div className="mt-2 h-2 rounded-full bg-oa-surface-2"><div className="h-2 rounded-full bg-gradient-to-r from-oa-blue to-oa-green" style={{ width: `${item.progress.percentage}%` }} /></div>
          <p className="mt-2 text-xs text-oa-text">{item.progress.currentStepDescription}</p>
        </div>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        {item.actions.includes("preview") && <button className="rounded-lg border border-oa-border bg-oa-surface-2 px-3 py-2 text-xs" onClick={() => onAction("preview", item.id)}><Eye className="mr-1 inline h-3.5 w-3.5" />Preview</button>}
        {item.actions.includes("approve_once") && <button className="rounded-lg bg-oa-green px-3 py-2 text-xs font-medium text-white" onClick={() => onAction("approve_once", item.id)}><CheckCircle2 className="mr-1 inline h-3.5 w-3.5" />Approve</button>}
        {item.actions.includes("deny") && <button className="rounded-lg border border-oa-border bg-oa-surface-2 px-3 py-2 text-xs" onClick={() => onAction("deny", item.id)}><ShieldAlert className="mr-1 inline h-3.5 w-3.5" />Deny</button>}
        {item.actions.includes("redact_approve") && <button className="rounded-lg border border-oa-border bg-oa-surface-2 px-3 py-2 text-xs" onClick={() => onAction("redact_approve", item.id)}><AlertTriangle className="mr-1 inline h-3.5 w-3.5" />Redact</button>}
      </div>
    </motion.article>
  );
}
