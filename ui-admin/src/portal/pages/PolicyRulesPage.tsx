import { FileDown, Play, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { useMemo, useState, type FC } from "react";
import { Card } from "../components/Card";
import { ErrorState } from "../components/ErrorState";
import { RefreshButton } from "../components/RefreshButton";
import { StatusPill, statusTone } from "../components/StatusPill";
import {
  useAdminPolicyRules,
  useCreateAdminPolicyRule,
  useDeleteAdminPolicyRule,
  useEvaluateAdminPolicy,
  type AdminPolicyAction,
  type AdminPolicyRule
} from "../api/queries";

const actions: AdminPolicyAction[] = ["require_approval", "deny", "allow"];

export const PolicyRulesPage: FC = () => {
  const rules = useAdminPolicyRules({ refetchInterval: 15_000 });
  const createRule = useCreateAdminPolicyRule();
  const deleteRule = useDeleteAdminPolicyRule();
  const evaluate = useEvaluateAdminPolicy();
  const [draft, setDraft] = useState({
    name: "PDF outbound review",
    role: "any",
    sensitivity: "any",
    fileExtension: "pdf",
    mimeType: "application/pdf",
    transferDirection: "outbound",
    maxFileSizeMb: "",
    action: "require_approval" as AdminPolicyAction,
    reason: "Human approval required before sharing this file."
  });
  const [probe, setProbe] = useState({
    role: "user",
    sensitivity: "internal",
    fileExtension: "pdf",
    mimeType: "application/pdf",
    transferDirection: "outbound",
    fileSizeMb: "2"
  });

  const sortedRules = useMemo(() => {
    return (rules.data ?? []).slice().sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
  }, [rules.data]);

  async function handleCreate() {
    const mb = Number(draft.maxFileSizeMb);
    await createRule.mutateAsync({
      name: draft.name.trim(),
      role: draft.role.trim() || "any",
      sensitivity: draft.sensitivity.trim() || "any",
      fileExtension: draft.fileExtension.trim() || "any",
      mimeType: draft.mimeType.trim() || "any",
      transferDirection: draft.transferDirection.trim() || "any",
      maxFileSizeBytes: Number.isFinite(mb) && mb > 0 ? Math.round(mb * 1024 * 1024) : null,
      action: draft.action,
      reason: draft.reason.trim() || undefined,
      enabled: true,
      priority: 100
    });
  }

  async function handleEvaluate() {
    const mb = Number(probe.fileSizeMb);
    await evaluate.mutateAsync({
      role: probe.role,
      sensitivity: probe.sensitivity,
      fileExtension: probe.fileExtension,
      mimeType: probe.mimeType,
      transferDirection: probe.transferDirection,
      fileSizeBytes: Number.isFinite(mb) && mb >= 0 ? Math.round(mb * 1024 * 1024) : undefined
    });
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-base font-semibold text-white">Policy Rules</h1>
          <p className="text-xs text-white/55">Admin guardrails for approvals, transfers, commands, and vault exports.</p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href="/policy/export.csv"
            className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-[11px] text-white/70 transition hover:bg-white/10 hover:text-white"
          >
            <FileDown className="h-3.5 w-3.5" />
            Export CSV
          </a>
          <RefreshButton onClick={() => rules.refetch()} isFetching={rules.isFetching} />
        </div>
      </header>

      {rules.isError ? (
        <ErrorState
          title="Could not load policy rules"
          error={rules.error}
          onRetry={() => rules.refetch()}
          details="The Admin Portal proxies /policy/* to the local agent. Confirm the local agent is running and LOCAL_AGENT_URL is correct."
        />
      ) : null}

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.6fr)]">
        <Card title="Rule builder" description="Rules match top-to-bottom by priority; unmatched actions require approval by default.">
          <div className="grid gap-2 md:grid-cols-2">
            <Field label="Rule name" value={draft.name} onChange={(name) => setDraft((d) => ({ ...d, name }))} />
            <SelectField label="Action" value={draft.action} options={actions} onChange={(action) => setDraft((d) => ({ ...d, action: action as AdminPolicyAction }))} />
            <Field label="Role" value={draft.role} onChange={(role) => setDraft((d) => ({ ...d, role }))} />
            <Field label="Sensitivity" value={draft.sensitivity} onChange={(sensitivity) => setDraft((d) => ({ ...d, sensitivity }))} />
            <Field label="Extension" value={draft.fileExtension} onChange={(fileExtension) => setDraft((d) => ({ ...d, fileExtension }))} />
            <Field label="MIME" value={draft.mimeType} onChange={(mimeType) => setDraft((d) => ({ ...d, mimeType }))} />
            <Field label="Direction" value={draft.transferDirection} onChange={(transferDirection) => setDraft((d) => ({ ...d, transferDirection }))} />
            <Field label="Max size MB" value={draft.maxFileSizeMb} onChange={(maxFileSizeMb) => setDraft((d) => ({ ...d, maxFileSizeMb }))} />
          </div>
          <Field label="Reason" value={draft.reason} onChange={(reason) => setDraft((d) => ({ ...d, reason }))} />
          <button
            type="button"
            disabled={!draft.name.trim() || createRule.isPending}
            onClick={handleCreate}
            className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-md border border-emerald-400/25 bg-emerald-400/10 px-3 text-xs font-medium text-emerald-100 transition hover:bg-emerald-400/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" />
            Save policy rule
          </button>
        </Card>

        <Card title="Decision simulator" description="Probe the effective policy without creating a transfer.">
          <div className="grid gap-2">
            <Field label="Role" value={probe.role} onChange={(role) => setProbe((p) => ({ ...p, role }))} />
            <Field label="Sensitivity" value={probe.sensitivity} onChange={(sensitivity) => setProbe((p) => ({ ...p, sensitivity }))} />
            <Field label="Extension" value={probe.fileExtension} onChange={(fileExtension) => setProbe((p) => ({ ...p, fileExtension }))} />
            <Field label="MIME" value={probe.mimeType} onChange={(mimeType) => setProbe((p) => ({ ...p, mimeType }))} />
            <Field label="Direction" value={probe.transferDirection} onChange={(transferDirection) => setProbe((p) => ({ ...p, transferDirection }))} />
            <Field label="Size MB" value={probe.fileSizeMb} onChange={(fileSizeMb) => setProbe((p) => ({ ...p, fileSizeMb }))} />
          </div>
          <button
            type="button"
            disabled={evaluate.isPending}
            onClick={handleEvaluate}
            className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-md border border-sky-400/25 bg-sky-400/10 px-3 text-xs font-medium text-sky-100 transition hover:bg-sky-400/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Play className="h-3.5 w-3.5" />
            Evaluate
          </button>
          {evaluate.data && (
            <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs text-white/70">
              <StatusPill tone={statusTone(evaluate.data.action === "allow" ? "active" : evaluate.data.action === "deny" ? "rejected" : "pending")}>
                {evaluate.data.action}
              </StatusPill>
              <p className="mt-2">{evaluate.data.reason}</p>
              {evaluate.data.matchedRuleName && <p className="mt-1 text-white/45">Matched {evaluate.data.matchedRuleName}</p>}
            </div>
          )}
        </Card>
      </div>

      <Card padded={false} title="Active policy rules" description={`${sortedRules.length} configured`}>
        <div className="overflow-auto">
          <table className="w-full border-collapse text-left text-xs text-white/80">
            <thead className="sticky top-0 bg-[#0d0d10]/95">
              <tr className="border-b border-white/10">
                <Th>Name</Th>
                <Th>Match</Th>
                <Th>Action</Th>
                <Th>Reason</Th>
                <Th>Updated</Th>
                <Th>Action</Th>
              </tr>
            </thead>
            <tbody>
              {sortedRules.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-10 text-center text-white/45">
                    No policy rules yet.
                  </td>
                </tr>
              ) : (
                sortedRules.map((rule) => (
                  <RuleRow key={rule.id} rule={rule} onDelete={() => deleteRule.mutate(rule.id)} deleting={deleteRule.isPending} />
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
};

const RuleRow: FC<{ rule: AdminPolicyRule; onDelete: () => void; deleting?: boolean }> = ({ rule, onDelete, deleting }) => (
  <tr className="border-b border-white/5 last:border-b-0">
    <td className="px-3 py-2 align-top">
      <div className="font-medium text-white">{rule.name}</div>
      <div className="mt-0.5 text-[10px] text-white/40">{rule.id.slice(0, 12)}...</div>
    </td>
    <td className="px-3 py-2 align-top text-white/60">
      <div>role {rule.role}</div>
      <div>{rule.fileExtension}/{rule.mimeType}</div>
      <div>{rule.transferDirection}, sensitivity {rule.sensitivity}</div>
    </td>
    <td className="px-3 py-2 align-top">
      <StatusPill tone={statusTone(rule.action === "allow" ? "active" : rule.action === "deny" ? "rejected" : "pending")}>{rule.action}</StatusPill>
    </td>
    <td className="max-w-sm px-3 py-2 align-top text-white/60">{rule.reason}</td>
    <td className="px-3 py-2 align-top text-white/45">{new Date(rule.updatedAt).toLocaleString()}</td>
    <td className="px-3 py-2 align-top">
      <button
        type="button"
        disabled={deleting}
        onClick={onDelete}
        className="inline-flex items-center gap-1.5 rounded-md border border-rose-400/30 bg-rose-400/10 px-2 py-1 text-[11px] text-rose-100 transition hover:bg-rose-400/20 disabled:cursor-not-allowed disabled:opacity-45"
      >
        <Trash2 className="h-3.5 w-3.5" />
        Delete
      </button>
    </td>
  </tr>
);

const Th: FC<{ children: string }> = ({ children }) => (
  <th className="whitespace-nowrap px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-white/55">{children}</th>
);

const Field: FC<{ label: string; value: string; onChange: (value: string) => void }> = ({ label, value, onChange }) => (
  <label className="block text-[11px] text-white/50">
    {label}
    <input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="mt-1 w-full rounded-md border border-white/10 bg-black/30 px-2.5 py-2 text-xs text-white outline-none transition focus:border-emerald-300/50"
    />
  </label>
);

const SelectField: FC<{ label: string; value: string; options: string[]; onChange: (value: string) => void }> = ({ label, value, options, onChange }) => (
  <label className="block text-[11px] text-white/50">
    {label}
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="mt-1 w-full rounded-md border border-white/10 bg-black/30 px-2.5 py-2 text-xs text-white outline-none transition focus:border-emerald-300/50"
    >
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  </label>
);
