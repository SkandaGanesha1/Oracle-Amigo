import { Card } from "../components/Card";
import { DataTable, type ColumnDef } from "../components/DataTable";
import { TimeAgo } from "../components/TimeAgo";
import { CopyableId } from "../components/CopyableId";
import { ErrorState } from "../components/ErrorState";
import { useAdminDevices, type AdminDevice } from "../api/queries";
import { RefreshButton } from "../components/RefreshButton";
import type { FC } from "react";

export const DevicesPage: FC = () => {
  const q = useAdminDevices({ refetchInterval: 15_000 });

  const columns: ColumnDef<AdminDevice, unknown>[] = [
    {
      header: "Device name",
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
      header: "Org",
      accessorKey: "org_slug",
      cell: (info) => <span className="text-white/55">{String(info.getValue() ?? info.row.original.org_id ?? "—")}</span>,
      enableSorting: false
    },
    {
      header: "Fingerprint",
      accessorKey: "public_key_fingerprint",
      cell: (info) => <CopyableId value={String(info.getValue() ?? "")} prefix={10} />,
      enableSorting: false
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
    }
  ];

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-base font-semibold text-white">Devices</h1>
          <p className="text-xs text-white/55">All enrolled devices across all organizations.</p>
        </div>
        <RefreshButton onClick={() => q.refetch()} isFetching={q.isFetching} />
      </header>
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} title="Could not load devices" />
      ) : (
        <Card padded={false} title="Enrolled devices">
          <DataTable<AdminDevice>
            data={q.data ?? []}
            columns={columns}
            rowKey={(row) => row.id}
            initialSort={[{ id: "created_at", desc: true }]}
            globalFilterPlaceholder="Search device, owner, org, fingerprint…"
          />
        </Card>
      )}
    </div>
  );
};
