import { Card } from "../components/Card";
import { VirtualDataTable, type ColumnDef } from "../components/VirtualDataTable";
import { TimeAgo } from "../components/TimeAgo";
import { CopyableId } from "../components/CopyableId";
import { ErrorState } from "../components/ErrorState";
import { useAdminTransfers, type AdminTransfer } from "../api/queries";
import { StatusPill, statusTone } from "../components/StatusPill";
import { RefreshButton } from "../components/RefreshButton";
import type { FC } from "react";

function formatBytes(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function expiryTone(iso: string): "red" | "amber" | "green" {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "green";
  const delta = t - Date.now();
  if (delta < 0) return "red";
  if (delta < 5 * 60_000) return "amber";
  return "green";
}

export const TransfersPage: FC = () => {
  const q = useAdminTransfers({ refetchInterval: 10_000 });

  const columns: ColumnDef<AdminTransfer, unknown>[] = [
    {
      header: "Transfer ID",
      accessorKey: "id",
      cell: (info) => <CopyableId value={String(info.getValue() ?? "")} />,
      enableSorting: false
    },
    {
      header: "File name",
      accessorKey: "file_name",
      cell: (info) => <span className="max-w-xs truncate font-medium text-white" title={String(info.getValue() ?? "")}>{String(info.getValue() ?? "—")}</span>
    },
    {
      header: "Size",
      accessorKey: "file_size",
      cell: (info) => <span className="tabular-nums text-white/70">{formatBytes(Number(info.getValue() ?? 0))}</span>,
      sortingFn: (a, b) => Number(a.original.file_size ?? 0) - Number(b.original.file_size ?? 0)
    },
    {
      header: "SHA-256",
      accessorKey: "sha256",
      cell: (info) => <CopyableId value={String(info.getValue() ?? "")} prefix={12} />,
      enableSorting: false
    },
    {
      header: "Status",
      accessorKey: "status",
      cell: (info) => {
        const s = String(info.getValue() ?? "");
        return (
          <StatusPill tone={statusTone(s)} title={s}>
            {s || "—"}
          </StatusPill>
        );
      }
    },
    {
      header: "Expires",
      accessorKey: "expires_at",
      cell: (info) => {
        const iso = String(info.getValue() ?? "");
        const tone = expiryTone(iso);
        return <TimeAgo iso={iso} />;
      },
      sortingFn: (a, b) => {
        const aT = new Date(String(a.original.expires_at ?? "")).getTime();
        const bT = new Date(String(b.original.expires_at ?? "")).getTime();
        return aT - bT;
      }
    },
    {
      header: "Created",
      accessorKey: "created_at",
      cell: (info) => <TimeAgo iso={String(info.getValue() ?? "")} />
    }
  ];

  const expiringSoon = (q.data ?? []).filter((row) => expiryTone(String(row.expires_at ?? "")) !== "green").length;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-base font-semibold text-white">File Transfers</h1>
          <p className="text-xs text-white/55">Latest 500 cross-device file transfers. AES-256-GCM, OAT1 envelope.</p>
        </div>
        <div className="flex items-center gap-2">
          {expiringSoon > 0 && (
            <span className="rounded-md border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[10px] text-amber-200">
              {expiringSoon} expiring soon
            </span>
          )}
          <RefreshButton onClick={() => q.refetch()} isFetching={q.isFetching} />
        </div>
      </header>
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} title="Could not load transfers" />
      ) : (
        <Card padded={false} title="File transfers" description="Click a row to copy its SHA-256.">
          <VirtualDataTable<AdminTransfer>
            data={q.data ?? []}
            columns={columns}
            rowKey={(row) => row.id}
            rowHeight={40}
            initialSort={[{ id: "created_at", desc: true }]}
            globalFilterPlaceholder="Search file, hash, status…"
          />
        </Card>
      )}
    </div>
  );
};
