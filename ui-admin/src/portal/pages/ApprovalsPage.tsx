import { Card } from "../components/Card";
import { DataTable, type ColumnDef } from "../components/DataTable";
import { TimeAgo } from "../components/TimeAgo";
import { CopyableId } from "../components/CopyableId";
import { ErrorState } from "../components/ErrorState";
import { RefreshButton } from "../components/RefreshButton";
import { StatusPill, statusTone } from "../components/StatusPill";
import { useAdminApprovals, type AdminApproval } from "../api/queries";
import type { FC } from "react";

export const ApprovalsPage: FC = () => {
  const q = useAdminApprovals({ refetchInterval: 10_000 });

  const columns: ColumnDef<AdminApproval, unknown>[] = [
    {
      header: "Relay task",
      accessorKey: "relay_task_id",
      cell: (info) => <CopyableId value={String(info.getValue() ?? "")} />
    },
    {
      header: "A2A task",
      accessorKey: "a2a_task_id",
      cell: (info) => <CopyableId value={String(info.getValue() ?? "")} />
    },
    {
      header: "Status",
      accessorKey: "task_status",
      cell: (info) => {
        const s = String(info.getValue() ?? "");
        return <StatusPill tone={statusTone(s)}>{s || "unknown"}</StatusPill>;
      }
    },
    {
      header: "From",
      accessorKey: "from_agent_instance_id",
      cell: (info) => <CopyableId value={String(info.getValue() ?? "")} prefix={8} />,
      enableSorting: false
    },
    {
      header: "To",
      accessorKey: "to_agent_instance_id",
      cell: (info) => <CopyableId value={String(info.getValue() ?? "")} prefix={8} />,
      enableSorting: false
    },
    {
      header: "Created",
      accessorKey: "created_at",
      cell: (info) => <TimeAgo iso={String(info.getValue() ?? "")} />
    }
  ];

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-base font-semibold text-white">Approvals</h1>
          <p className="text-xs text-white/55">Approval-related relay tasks without file bytes or local paths.</p>
        </div>
        <RefreshButton onClick={() => q.refetch()} isFetching={q.isFetching} />
      </header>
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} title="Could not load approvals" />
      ) : (
        <Card padded={false} title="Approval relay activity">
          <DataTable<AdminApproval>
            data={q.data ?? []}
            columns={columns}
            rowKey={(row) => row.relay_task_id}
            initialSort={[{ id: "created_at", desc: true }]}
            globalFilterPlaceholder="Search task, agent, status..."
          />
        </Card>
      )}
    </div>
  );
};
