import { ShieldAlert } from "lucide-react";
import { Card } from "../components/Card";
import { DataTable, type ColumnDef } from "../components/DataTable";
import { CopyableId } from "../components/CopyableId";
import { StatusPill, statusTone } from "../components/StatusPill";
import {
  useAdminAgentInstances,
  useAdminDevices,
  useAdminUsers,
  useDisableAgentInstance,
  useDisableUser,
  useRevokeDevice,
  type AdminAgentInstance,
  type AdminDevice,
  type AdminUser
} from "../api/queries";
import type { FC } from "react";

export const SecurityPage: FC = () => {
  const users = useAdminUsers({ refetchInterval: 15_000 });
  const devices = useAdminDevices({ refetchInterval: 15_000 });
  const instances = useAdminAgentInstances({ refetchInterval: 15_000 });
  const disableUser = useDisableUser();
  const revokeDevice = useRevokeDevice();
  const disableInstance = useDisableAgentInstance();

  const userColumns: ColumnDef<AdminUser, unknown>[] = [
    { header: "Email", accessorKey: "email", cell: (info) => <span className="text-white">{String(info.getValue() ?? "")}</span> },
    { header: "Status", accessorKey: "status", cell: (info) => <StatusPill tone={statusTone(String(info.getValue() ?? "active"))}>{String(info.getValue() ?? "active")}</StatusPill> },
    { header: "ID", accessorKey: "id", cell: (info) => <CopyableId value={String(info.getValue() ?? "")} />, enableSorting: false },
    {
      header: "Action",
      accessorKey: "id",
      cell: (info) => (
        <button
          type="button"
          disabled={String(info.row.original.status ?? "active") === "disabled" || disableUser.isPending}
          onClick={() => disableUser.mutate(info.row.original.id)}
          className="rounded-md border border-rose-400/30 bg-rose-400/10 px-2 py-1 text-[11px] text-rose-100 transition hover:bg-rose-400/20 disabled:cursor-not-allowed disabled:opacity-45"
        >
          Disable user
        </button>
      ),
      enableSorting: false
    }
  ];

  const deviceColumns: ColumnDef<AdminDevice, unknown>[] = [
    { header: "Device", accessorKey: "device_name", cell: (info) => <span className="text-white">{String(info.getValue() ?? "")}</span> },
    { header: "Owner", accessorKey: "owner_email", cell: (info) => <span className="text-white/70">{String(info.getValue() ?? "")}</span>, enableSorting: false },
    { header: "Status", accessorKey: "status", cell: (info) => <StatusPill tone={statusTone(String(info.getValue() ?? "active"))}>{String(info.getValue() ?? "active")}</StatusPill> },
    { header: "ID", accessorKey: "id", cell: (info) => <CopyableId value={String(info.getValue() ?? "")} />, enableSorting: false },
    {
      header: "Action",
      accessorKey: "id",
      cell: (info) => (
        <button
          type="button"
          disabled={String(info.row.original.status ?? "active") === "revoked" || revokeDevice.isPending}
          onClick={() => revokeDevice.mutate(info.row.original.id)}
          className="rounded-md border border-rose-400/30 bg-rose-400/10 px-2 py-1 text-[11px] text-rose-100 transition hover:bg-rose-400/20 disabled:cursor-not-allowed disabled:opacity-45"
        >
          Revoke device
        </button>
      ),
      enableSorting: false
    }
  ];

  const instanceColumns: ColumnDef<AdminAgentInstance, unknown>[] = [
    { header: "Agent", accessorKey: "agent_display_name", cell: (info) => <span className="text-white">{String(info.getValue() ?? "")}</span> },
    { header: "Owner", accessorKey: "owner_email", cell: (info) => <span className="text-white/70">{String(info.getValue() ?? "")}</span>, enableSorting: false },
    { header: "Status", accessorKey: "status", cell: (info) => <StatusPill tone={statusTone(String(info.getValue() ?? "active"))}>{String(info.getValue() ?? "active")}</StatusPill> },
    { header: "ID", accessorKey: "id", cell: (info) => <CopyableId value={String(info.getValue() ?? "")} />, enableSorting: false },
    {
      header: "Action",
      accessorKey: "id",
      cell: (info) => (
        <button
          type="button"
          disabled={String(info.row.original.status ?? "active") !== "active" || disableInstance.isPending}
          onClick={() => disableInstance.mutate(info.row.original.id)}
          className="rounded-md border border-rose-400/30 bg-rose-400/10 px-2 py-1 text-[11px] text-rose-100 transition hover:bg-rose-400/20 disabled:cursor-not-allowed disabled:opacity-45"
        >
          Disable agent
        </button>
      ),
      enableSorting: false
    }
  ];

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-base font-semibold text-white">Security / Revocation</h1>
          <p className="text-xs text-white/55">Operational controls for users, devices, and agent instances.</p>
        </div>
        <div className="inline-flex items-center gap-1.5 rounded-md border border-amber-400/25 bg-amber-400/10 px-2 py-1 text-[11px] text-amber-100">
          <ShieldAlert className="h-3.5 w-3.5" />
          Actions are terminal until manually repaired in the database.
        </div>
      </header>
      <Card padded={false} title="Users">
        <DataTable<AdminUser>
          data={users.data ?? []}
          columns={userColumns}
          rowKey={(row) => row.id}
          globalFilterPlaceholder="Search users..."
          density="compact"
        />
      </Card>
      <Card padded={false} title="Devices">
        <DataTable<AdminDevice>
          data={devices.data ?? []}
          columns={deviceColumns}
          rowKey={(row) => row.id}
          globalFilterPlaceholder="Search devices..."
          density="compact"
        />
      </Card>
      <Card padded={false} title="Agent instances">
        <DataTable<AdminAgentInstance>
          data={instances.data ?? []}
          columns={instanceColumns}
          rowKey={(row) => row.id}
          globalFilterPlaceholder="Search agent instances..."
          density="compact"
        />
      </Card>
    </div>
  );
};
