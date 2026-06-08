import { Card } from "../components/Card";
import { DataTable, type ColumnDef } from "../components/DataTable";
import { TimeAgo } from "../components/TimeAgo";
import { CopyableId } from "../components/CopyableId";
import { ErrorState } from "../components/ErrorState";
import { useAdminUsers, useDisableUser, type AdminUser } from "../api/queries";
import { RefreshButton } from "../components/RefreshButton";
import { StatusPill, statusTone } from "../components/StatusPill";
import { Inbox } from "lucide-react";
import type { FC } from "react";

export const UsersPage: FC = () => {
  const q = useAdminUsers({ refetchInterval: 15_000 });
  const disableUser = useDisableUser();

  const columns: ColumnDef<AdminUser, unknown>[] = [
    {
      header: "Email",
      accessorKey: "email",
      cell: (info) => <span className="text-white">{String(info.getValue() ?? "—")}</span>
    },
    {
      header: "Display name",
      accessorKey: "display_name",
      cell: (info) => <span className="text-white/80">{String(info.getValue() ?? "—")}</span>
    },
    {
      header: "Org",
      accessorKey: "org_slug",
      cell: (info) => <span className="text-white/55">{String(info.getValue() ?? info.row.original.org_id ?? "—")}</span>,
      enableSorting: false
    },
    {
      header: "Status",
      accessorKey: "status",
      cell: (info) => {
        const s = String(info.getValue() ?? "active");
        return <StatusPill tone={statusTone(s)}>{s}</StatusPill>;
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
        const disabled = String(row.status ?? "active") === "disabled" || disableUser.isPending;
        return (
          <button
            type="button"
            disabled={disabled}
            onClick={() => disableUser.mutate(row.id)}
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
          <h1 className="text-base font-semibold text-white">Users</h1>
          <p className="text-xs text-white/55">All users across all organizations.</p>
        </div>
        <RefreshButton onClick={() => q.refetch()} isFetching={q.isFetching} />
      </header>
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} title="Could not load users" />
      ) : (
        <Card padded={false} title="All users">
          <DataTable<AdminUser>
            data={q.data ?? []}
            columns={columns}
            rowKey={(row) => row.id}
            initialSort={[{ id: "created_at", desc: true }]}
            globalFilterPlaceholder="Search email, name, org…"
            empty={
              <span className="inline-flex items-center gap-1.5">
                <Inbox className="h-3.5 w-3.5" /> No users yet.
              </span>
            }
          />
        </Card>
      )}
    </div>
  );
};
