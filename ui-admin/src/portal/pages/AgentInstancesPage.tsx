import { Card } from "../components/Card";
import { DataTable, type ColumnDef } from "../components/DataTable";
import { TimeAgo } from "../components/TimeAgo";
import { CopyableId } from "../components/CopyableId";
import { ErrorState } from "../components/ErrorState";
import { useAdminAgentInstances, useDisableAgentInstance, type AdminAgentInstance } from "../api/queries";
import { StatusPill, statusTone } from "../components/StatusPill";
import { RefreshButton } from "../components/RefreshButton";
import type { FC } from "react";

export const AgentInstancesPage: FC = () => {
  const q = useAdminAgentInstances({ refetchInterval: 10_000 });
  const disableInstance = useDisableAgentInstance();

  const columns: ColumnDef<AdminAgentInstance, unknown>[] = [
    {
      header: "Agent",
      accessorKey: "agent_display_name",
      cell: (info) => <span className="font-medium text-white">{String(info.getValue() ?? "—")}</span>
    },
    {
      header: "Device",
      accessorKey: "device_name",
      cell: (info) => <span className="text-white/70">{String(info.getValue() ?? "—")}</span>,
      enableSorting: false
    },
    {
      header: "Owner",
      accessorKey: "owner_email",
      cell: (info) => <span className="text-white/70">{String(info.getValue() ?? "—")}</span>,
      enableSorting: false
    },
    {
      header: "Status",
      accessorKey: "status",
      cell: (info) => {
        const s = String(info.getValue() ?? "");
        return (
          <StatusPill tone={statusTone(s)} title={s || undefined}>
            {s || "—"}
          </StatusPill>
        );
      }
    },
    {
      header: "Created",
      accessorKey: "created_at",
      cell: (info) => <TimeAgo iso={String(info.getValue() ?? "")} />
    },
    {
      header: "ID",
      accessorKey: "id",
      cell: (info) => <CopyableId value={String(info.getValue() ?? "")} />,
      enableSorting: false
    },
    {
      header: "Actions",
      accessorKey: "id",
      cell: (info) => {
        const row = info.row.original;
        const disabled = String(row.status ?? "active") !== "active" || disableInstance.isPending;
        return (
          <button
            type="button"
            disabled={disabled}
            onClick={() => disableInstance.mutate(row.id)}
            className="rounded-md border border-rose-400/30 bg-rose-400/10 px-2 py-1 text-[11px] text-rose-100 transition hover:bg-rose-400/20 disabled:cursor-not-allowed disabled:opacity-45"
          >
            Disable
          </button>
        );
      },
      enableSorting: false
    }
  ];

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-base font-semibold text-white">Agent Instances</h1>
          <p className="text-xs text-white/55">All agent instances running across all devices.</p>
        </div>
        <RefreshButton onClick={() => q.refetch()} isFetching={q.isFetching} />
      </header>
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} title="Could not load agent instances" />
      ) : (
        <Card padded={false} title="Running agent instances">
          <DataTable<AdminAgentInstance>
            data={q.data ?? []}
            columns={columns}
            rowKey={(row) => row.id}
            initialSort={[{ id: "created_at", desc: true }]}
            globalFilterPlaceholder="Search agent, device, owner, status…"
          />
        </Card>
      )}
    </div>
  );
};
