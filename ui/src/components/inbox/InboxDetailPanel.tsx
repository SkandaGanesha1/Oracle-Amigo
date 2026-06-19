import { Archive, CheckCircle2, Clock3, ExternalLink, Eye, FileText, HelpCircle, MessageCircle, Shield, ShieldAlert, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import type { InboxActionId, InboxItem } from "../../api/types";
import { formatInboxTime } from "./InboxItemRow";
import { decisionActionMotion, detailPanelVariants, m, motionTransition } from "../primitives/MotionPrimitives";

export function InboxDetailPanel({
  item,
  privacyMode,
  onAction
}: {
  item: InboxItem | null;
  privacyMode: boolean;
  onAction: (action: InboxActionId, item: InboxItem) => void;
}) {
  if (!item) return null;

  return (
    <m.aside
      layout
      className="oa-inbox-detail min-h-0 overflow-y-auto border-l border-oa-border bg-oa-surface/70"
      variants={detailPanelVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      transition={motionTransition.panel}
    >
      <header className="sticky top-0 z-10 border-b border-oa-border bg-oa-surface/95 p-4 backdrop-blur">
        <p className="text-[11px] uppercase tracking-[0.2em] text-oa-text-muted">{item.kind.replaceAll("_", " ")}</p>
        <h2 className="mt-1 text-lg font-semibold text-oa-text">{item.title}</h2>
        <p className="mt-1 text-sm leading-6 text-oa-text-muted">{item.summary}</p>
        <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
          <Pill>{item.status}</Pill>
          <Pill>{item.priority}</Pill>
          <Pill>{formatInboxTime(item.updatedAt)}</Pill>
        </div>
        <div className="mt-4">
          <InboxDecisionBar item={item} onAction={onAction} />
        </div>
      </header>

      <m.div layout className="space-y-4 p-4">
        <InboxRiskSummary item={item} />
        <Panel title="Data movement" icon={FileText}>
          <Info label="File" value={mask(item.file?.name ?? "No file attached", privacyMode && item.privacy.sensitivity !== "low")} />
          <Info label="Size" value={item.file?.sizeBytes ? `${item.file.sizeBytes.toLocaleString()} bytes` : "Unknown"} />
          <Info label="Source" value={item.requester?.label ?? "System"} />
          <Info label="Destination" value={item.target?.label ?? "Oracle Amigo"} />
          <Info label="Leaves device" value={item.privacy.leavesDevice ? "Yes" : "No"} />
          <Info label="Expires" value={item.privacy.expiresAt ? new Date(item.privacy.expiresAt).toLocaleString() : "No expiry"} />
          <Info label="Revocable" value={item.privacy.revocable ? "Yes" : "No"} />
        </Panel>
        <Panel title="Trust" icon={Shield}>
          <Info label="Requester" value={item.requester?.label ?? "System"} />
          <Info label="Trust" value={item.requester?.trustLabel ?? "Unknown"} />
          <Info label="Verified" value={item.requester?.verified ? "Verified" : "Unverified"} />
          <Info label="Sensitivity" value={item.privacy.sensitivity} />
        </Panel>
        <Panel title="Evidence" icon={Eye}>
          <Info label="Risk" value={`${item.risk.level}: ${item.risk.reasons.join(", ")}`} />
          <Info label="Path" value={mask(item.file?.path ?? "Local path hidden", privacyMode || item.privacy.masked)} />
          <Info label="SHA-256" value={mask(item.file?.sha256 ?? "Not available", privacyMode && item.privacy.sensitivity !== "low")} />
          <Info label="Match" value={item.file?.matchScore != null ? `${Math.round(item.file.matchScore * 100)}%` : "Not scored"} />
        </Panel>
        <Panel title="Timeline" icon={Clock3}>
          <Info label="Created" value={new Date(item.createdAt).toLocaleString()} />
          <Info label="Updated" value={new Date(item.updatedAt).toLocaleString()} />
          <Info label="Due" value={item.dueAt ? new Date(item.dueAt).toLocaleString() : "No due date"} />
        </Panel>
        <Panel title="Audit" icon={ShieldAlert}>
          <Info label="Audit ID" value={item.auditId ?? item.approvalId ?? item.transferId ?? item.id} />
          <Info label="Conversation" value={item.conversationId ?? "Not linked"} />
        </Panel>
      </m.div>
    </m.aside>
  );
}

function InboxDecisionBar({ item, onAction }: { item: InboxItem; onAction: (action: InboxActionId, item: InboxItem) => void }) {
  const iconByAction: Partial<Record<InboxActionId, typeof CheckCircle2>> = {
    preview: Eye,
    approve: CheckCircle2,
    deny: XCircle,
    ask_why: HelpCircle,
    snooze: Clock3,
    archive: Archive,
    open_chat: MessageCircle,
    view_audit: ExternalLink
  };
  return (
    <div className="oa-inbox-action-bar" aria-label="Inbox item actions">
      {item.actions.map((action) => {
        const Icon = iconByAction[action.id] ?? CheckCircle2;
        return (
          <m.button
            key={action.id}
            type="button"
            disabled={Boolean(action.disabledReason)}
            onClick={() => onAction(action.id, item)}
            aria-label={action.label}
            {...decisionActionMotion}
            transition={motionTransition.quick}
            className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-3 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              action.primary ? "bg-oa-blue text-white hover:bg-oa-blue/90" : action.destructive ? "bg-oa-red/10 text-oa-red hover:bg-oa-red/15" : "border border-oa-border bg-oa-surface-2 text-oa-text-muted hover:text-oa-text"
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {action.label}
          </m.button>
        );
      })}
    </div>
  );
}

function InboxRiskSummary({ item }: { item: InboxItem }) {
  const leavesDevice = item.privacy.leavesDevice;
  const reasons = item.risk.reasons.length > 0
    ? item.risk.reasons.join(" ")
    : leavesDevice
      ? "This item may move data outside the device."
      : "This item stays on this device.";
  const checks = [
    item.file?.sha256 ? "File hash verified" : "File hash unavailable",
    item.requester?.verified ? "Requester confirmed" : "Requester not verified",
    leavesDevice ? "Leaves device" : "Stays on device",
    item.actions.some((action) => action.id === "approve" || action.id === "deny") ? "User approval required" : "No approval action required"
  ];

  return (
    <section className="oa-risk-summary" aria-label="Risk explanation">
      <div className="oa-risk-summary-head">
        <ShieldAlert size={18} aria-hidden="true" />
        <div>
          <h3 className="oa-risk-summary-title">{item.risk.level} risk</h3>
          <p className="oa-risk-summary-copy">{reasons}</p>
        </div>
      </div>
      <ul className="oa-risk-checklist">
        {checks.map((check) => (
          <li key={check}>
            <CheckCircle2 size={14} aria-hidden="true" />
            {check}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Panel({ children, icon: Icon, title }: { children: ReactNode; icon: typeof Shield; title: string }) {
  return (
    <m.section layout className="rounded-xl border border-oa-border bg-oa-bg-elevated p-3">
      <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-oa-text-muted">
        <Icon className="h-3.5 w-3.5" />
        {title}
      </div>
      <div className="space-y-2">{children}</div>
    </m.section>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[112px_minmax(0,1fr)] gap-3 text-xs">
      <span className="text-oa-text-disabled">{label}</span>
      <span className="min-w-0 break-words text-oa-text-muted">{value}</span>
    </div>
  );
}

function Pill({ children }: { children: string }) {
  return <span className="rounded-full border border-oa-border bg-oa-surface-2 px-2 py-1 text-oa-text-muted">{children}</span>;
}

function mask(value: string, masked: boolean): string {
  if (!masked) return value;
  if (!value || value === "Not available") return value;
  return "Masked by privacy mode";
}
