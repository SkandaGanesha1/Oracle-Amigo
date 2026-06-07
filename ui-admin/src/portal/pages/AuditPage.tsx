import { useMemo, useState, type FC } from "react";
import { Card } from "../components/Card";
import { VirtualDataTable, type ColumnDef } from "../components/VirtualDataTable";
import { TimeAgo } from "../components/TimeAgo";
import { CopyableId } from "../components/CopyableId";
import { ErrorState } from "../components/ErrorState";
import { useAdminAudit, type AdminAuditEvent } from "../api/queries";
import { RefreshButton } from "../components/RefreshButton";
import { ChainIntegrityBadge } from "../components/ChainIntegrityBadge";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";

async function sha256Hex(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const buffer = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(buffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
  return "no-webcrypto";
}

interface ChainCheck {
  valid: boolean;
  brokenAtId?: number;
  message?: string;
}

async function verifyChain(events: AdminAuditEvent[]): Promise<ChainCheck> {
  if (events.length === 0) return { valid: true };
  const ascending = [...events].sort((a, b) => Number(a.id) - Number(b.id));
  let previousHash = "";
  for (const event of ascending) {
    const details = typeof event.details_json === "string" ? event.details_json : JSON.stringify(event.details_json ?? {});
    const payload = [
      event.id,
      event.org_id,
      event.actor_user_id ?? "",
      event.actor_agent_instance_id ?? "",
      event.event_type,
      details,
      previousHash,
      event.created_at
    ].join("|");
    const recomputed = await sha256Hex(payload);
    if (recomputed !== event.event_hash) {
      return { valid: false, brokenAtId: Number(event.id), message: `event_hash mismatch at #${event.id}` };
    }
    if (event.previous_hash !== previousHash) {
      return { valid: false, brokenAtId: Number(event.id), message: `previous_hash mismatch at #${event.id}` };
    }
    previousHash = event.event_hash;
  }
  return { valid: true };
}

export const AuditPage: FC = () => {
  const q = useAdminAudit({ refetchInterval: 15_000 });
  const [verifying, setVerifying] = useState(false);
  const [check, setCheck] = useState<ChainCheck | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const handleVerify = async () => {
    if (!q.data) return;
    setVerifying(true);
    setCheck(null);
    try {
      const result = await verifyChain(q.data);
      setCheck(result);
    } catch (err) {
      setCheck({ valid: false, message: err instanceof Error ? err.message : "Unknown verifier error" });
    } finally {
      setVerifying(false);
    }
  };

  const columns: ColumnDef<AdminAuditEvent, unknown>[] = useMemo(
    () => [
      {
        header: "When",
        accessorKey: "created_at",
        cell: (info) => <TimeAgo iso={String(info.getValue() ?? "")} />
      },
      {
        header: "Type",
        accessorKey: "event_type",
        cell: (info) => <span className="font-mono text-[11px] text-white/85">{String(info.getValue() ?? "—")}</span>
      },
      {
        header: "Actor",
        id: "actor",
        cell: (info) => {
          const row = info.row.original;
          const userId = row.actor_user_id;
          const agentId = row.actor_agent_instance_id;
          if (userId) return <span className="text-white/75">user <CopyableId value={String(userId)} prefix={8} /></span>;
          if (agentId) return <span className="text-white/75">agent <CopyableId value={String(agentId)} prefix={8} /></span>;
          return <span className="text-white/40">—</span>;
        },
        enableSorting: false
      },
      {
        header: "Details",
        id: "details",
        cell: (info) => {
          const row = info.row.original;
          const isOpen = expandedId === Number(row.id);
          let pretty = "";
          try {
            pretty = typeof row.details_json === "string" ? row.details_json : JSON.stringify(row.details_json ?? {}, null, 2);
          } catch {
            pretty = String(row.details_json);
          }
          return (
            <button
              type="button"
              onClick={() => setExpandedId(isOpen ? null : Number(row.id))}
              className="max-w-md truncate rounded px-1 py-0.5 text-left font-mono text-[10px] text-white/60 transition hover:bg-white/5 hover:text-white"
            >
              {isOpen ? "▼" : "▶"} {pretty.slice(0, 200)}
            </button>
          );
        },
        enableSorting: false
      },
      {
        header: "Hash",
        accessorKey: "event_hash",
        cell: (info) => <CopyableId value={String(info.getValue() ?? "")} prefix={10} />,
        enableSorting: false
      }
    ],
    [expandedId]
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-base font-semibold text-white">Cloud Audit Log</h1>
          <p className="text-xs text-white/55">SHA-256 hash-chained events from the control plane.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleVerify}
            disabled={verifying || !q.data || q.data.length === 0}
            className="inline-flex items-center gap-1.5 rounded-md border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-1.5 text-[11px] text-emerald-200 transition hover:bg-emerald-400/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {verifying ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
            Verify chain
          </button>
          <RefreshButton onClick={() => q.refetch()} isFetching={q.isFetching} />
        </div>
      </header>
      {check && (
        <div
          className={`flex items-start gap-2 rounded-md border p-3 text-xs ${
            check.valid
              ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
              : "border-rose-400/30 bg-rose-500/10 text-rose-200"
          }`}
        >
          {check.valid ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
          <div>
            <p className="font-semibold">
              {check.valid ? "Chain verified" : "Chain integrity broken"}
              {check.brokenAtId ? ` at event #${check.brokenAtId}` : null}
            </p>
            {check.message && <p className="mt-0.5 text-[11px] opacity-80">{check.message}</p>}
          </div>
        </div>
      )}
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} title="Could not load audit log" />
      ) : (
        <Card padded={false} title="Latest 500 audit events" actions={<ChainIntegrityBadge count={q.data?.length ?? 0} />}>
          <VirtualDataTable<AdminAuditEvent>
            data={q.data ?? []}
            columns={columns}
            rowKey={(row) => row.id}
            rowHeight={42}
            initialSort={[{ id: "created_at", desc: true }]}
            globalFilterPlaceholder="Search event type, actor, details…"
          />
        </Card>
      )}
    </div>
  );
};
