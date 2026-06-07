import { Card } from "../components/Card";
import { DataTable, type ColumnDef } from "../components/DataTable";
import { TimeAgo } from "../components/TimeAgo";
import { CopyableId } from "../components/CopyableId";
import { ErrorState } from "../components/ErrorState";
import { useAdminTasks, type AdminTask } from "../api/queries";
import { StatusPill, statusTone } from "../components/StatusPill";
import { RefreshButton } from "../components/RefreshButton";
import type { FC } from "react";

export const TasksPage: FC = () => {
  const q = useAdminTasks({ refetchInterval: 10_000 });

  const columns: ColumnDef<AdminTask, unknown>[] = [
    {
      header: "Task ID",
      accessorKey: "id",
      cell: (info) => <CopyableId value={String(info.getValue() ?? "")} />,
      enableSorting: false
    },
    {
      header: "From",
      accessorKey: "from_agent_instance_id",
      cell: (info) => <CopyableId value={String(info.getValue() ?? "")} prefix={10} />,
      enableSorting: false
    },
    {
      header: "To",
      accessorKey: "to_agent_instance_id",
      cell: (info) => <CopyableId value={String(info.getValue() ?? "")} prefix={10} />,
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
      header: "Created",
      accessorKey: "created_at",
      cell: (info) => <TimeAgo iso={String(info.getValue() ?? "")} />
    },
    {
      header: "Completed",
      accessorKey: "completed_at",
      cell: (info) => <TimeAgo iso={info.getValue() ? String(info.getValue()) : null} fallback="—" />,
      sortingFn: (a, b) => {
        const aT = a.original.completed_at ? new Date(String(a.original.completed_at)).getTime() : 0;
        const bT = b.original.completed_at ? new Date(String(b.original.completed_at)).getTime() : 0;
        return aT - bT;
      }
    }
  ];

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-base font-semibold text-white">Tasks</h1>
          <p className="text-xs text-white/55">Latest 500 A2A relay tasks.</p>
        </div>
        <RefreshButton onClick={() => q.refetch()} isFetching={q.isFetching} />
      </header>
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} title="Could not load tasks" />
      ) : (
        <Card padded={false} title="Relay tasks">
          <DataTable<AdminTask>
            data={q.data ?? []}
            columns={columns}
            rowKey={(row) => row.id}
            initialSort={[{ id: "created_at", desc: true }]}
            globalFilterPlaceholder="Search task, instance, status…"
          />
        </Card>
      )}
    </div>
  );
};
