import { Card } from "../components/Card";
import { DataTable, type ColumnDef } from "../components/DataTable";
import { TimeAgo } from "../components/TimeAgo";
import { ErrorState } from "../components/ErrorState";
import { useAdminPresence, type AdminPresence } from "../api/queries";
import { StatusPill, statusTone } from "../components/StatusPill";
import { RefreshButton } from "../components/RefreshButton";
import type { FC } from "react";

function presenceTone(iso: string): "green" | "amber" | "red" {
  const ageSec = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (ageSec < 60) return "green";
  if (ageSec < 300) return "amber";
  return "red";
}

function presenceLabel(tone: "green" | "amber" | "red"): string {
  return tone === "green" ? "online" : tone === "amber" ? "stale" : "offline";
}

export const PresencePage: FC = () => {
  const q = useAdminPresence({ refetchInterval: 5_000 });

  const columns: ColumnDef<AdminPresence, unknown>[] = [
    {
      header: "Device",
      accessorKey: "device_name",
      cell: (info) => <span className="font-medium text-white">{String(info.getValue() ?? "—")}</span>
    },
    {
      header: "Owner",
      accessorKey: "owner_email",
      cell: (info) => <span className="text-white/70">{String(info.getValue() ?? "—")}</span>,
      enableSorting: false
    },
    {
      header: "Last heartbeat",
      accessorKey: "last_heartbeat_at",
      cell: (info) => <TimeAgo iso={String(info.getValue() ?? "")} />,
      sortingFn: (a, b) => {
        const aT = new Date(String(a.original.last_heartbeat_at ?? "")).getTime();
        const bT = new Date(String(b.original.last_heartbeat_at ?? "")).getTime();
        return aT - bT;
      }
    },
    {
      header: "Status",
      id: "presence_status",
      cell: (info) => {
        const iso = String(info.row.original.last_heartbeat_at ?? "");
        const tone = presenceTone(iso);
        return <StatusPill tone={statusTone(presenceLabel(tone))}>{presenceLabel(tone)}</StatusPill>;
      },
      enableSorting: false
    }
  ];

  const counts = (q.data ?? []).reduce(
    (acc, row) => {
      const tone = presenceTone(String(row.last_heartbeat_at ?? ""));
      acc[tone] += 1;
      acc.total += 1;
      return acc;
    },
    { green: 0, amber: 0, red: 0, total: 0 } as Record<"green" | "amber" | "red" | "total", number>
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-base font-semibold text-white">Presence</h1>
          <p className="text-xs text-white/55">Devices are online within 60s, stale after 5m, offline after that.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-md border border-emerald-400/20 bg-emerald-400/10 px-2 py-0.5 text-[10px] text-emerald-200">
            online {counts.green}
          </span>
          <span className="rounded-md border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[10px] text-amber-200">
            stale {counts.amber}
          </span>
          <span className="rounded-md border border-rose-400/30 bg-rose-400/10 px-2 py-0.5 text-[10px] text-rose-200">
            offline {counts.red}
          </span>
          <RefreshButton onClick={() => q.refetch()} isFetching={q.isFetching} />
        </div>
      </header>
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} title="Could not load presence" />
      ) : (
        <Card padded={false} title={`Devices reporting presence · ${counts.total}`}>
          <DataTable<AdminPresence>
            data={q.data ?? []}
            columns={columns}
            rowKey={(row) => row.id}
            initialSort={[{ id: "last_heartbeat_at", desc: false }]}
            globalFilterPlaceholder="Search device, owner…"
          />
        </Card>
      )}
    </div>
  );
};
