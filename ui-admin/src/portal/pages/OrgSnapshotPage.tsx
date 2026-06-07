import { useEffect, useState, type FC } from "react";
import { Card } from "../components/Card";
import { ChainIntegrityBadge } from "../components/ChainIntegrityBadge";
import { useAdminOrgSnapshot } from "../api/queries";
import { ErrorState } from "../components/ErrorState";
import { KV } from "../components/KV";
import { TimeAgo } from "../components/TimeAgo";
import { CopyableId } from "../components/CopyableId";
import { Skeleton } from "../components/Skeleton";
import { RefreshButton } from "../components/RefreshButton";
import { StatusPill, statusTone } from "../components/StatusPill";

export const OrgSnapshotPage: FC<{ orgId: string }> = ({ orgId }) => {
  const q = useAdminOrgSnapshot(orgId);
  const [tab, setTab] = useState<"users" | "devices" | "agents" | "instances" | "presence" | "tasks" | "transfers" | "audit">("users");

  useEffect(() => {
    setTab("users");
  }, [orgId]);

  if (q.isError) {
    return <ErrorState error={q.error} onRetry={() => q.refetch()} title={`Could not load snapshot for ${orgId}`} />;
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-base font-semibold text-white">Org snapshot</h1>
          <p className="text-xs text-white/55">
            Org <CopyableId value={orgId} prefix={12} />
          </p>
        </div>
        <RefreshButton onClick={() => q.refetch()} isFetching={q.isFetching} />
      </header>

      <div className="flex flex-wrap gap-1.5 text-[11px]">
        {(["users", "devices", "agents", "instances", "presence", "tasks", "transfers", "audit"] as const).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`rounded-md border px-2.5 py-1 capitalize transition ${
              tab === key
                ? "border-emerald-400/40 bg-emerald-400/15 text-emerald-100"
                : "border-white/10 bg-white/5 text-white/65 hover:bg-white/10"
            }`}
          >
            {key}{" "}
            <span className="ml-1 rounded bg-white/10 px-1 text-[10px] text-white/55">
              {q.data ? (q.data as unknown as Record<string, unknown[]>)[key]?.length ?? 0 : "…"}
            </span>
          </button>
        ))}
      </div>

      {!q.data ? (
        <Skeleton rows={6} />
      ) : tab === "users" ? (
        <Card title="Users">
          <ul className="grid gap-2 sm:grid-cols-2">
            {q.data.users.map((user) => (
              <li key={user.id} className="rounded-md border border-white/5 bg-white/[0.02] p-3">
                <KV label="Email" value={user.email ?? "—"} />
                <KV label="Display name" value={user.display_name ?? "—"} />
                <KV label="Created" value={<TimeAgo iso={user.created_at} />} />
              </li>
            ))}
          </ul>
        </Card>
      ) : tab === "devices" ? (
        <Card title="Devices">
          <ul className="grid gap-2 sm:grid-cols-2">
            {q.data.devices.map((device) => (
              <li key={device.id} className="rounded-md border border-white/5 bg-white/[0.02] p-3">
                <KV label="Device name" value={device.device_name ?? "—"} />
                <KV label="Fingerprint" value={<CopyableId value={device.public_key_fingerprint ?? ""} prefix={10} />} />
                <KV label="Created" value={<TimeAgo iso={device.created_at} />} />
              </li>
            ))}
          </ul>
        </Card>
      ) : tab === "agents" ? (
        <Card title="Agents">
          <ul className="grid gap-2 sm:grid-cols-2">
            {q.data.agents.map((agent) => (
              <li key={String((agent as { id?: string }).id ?? Math.random())} className="rounded-md border border-white/5 bg-white/[0.02] p-3">
                <KV label="Name" value={String((agent as { display_name?: string }).display_name ?? "—")} />
                <KV label="ID" value={<CopyableId value={String((agent as { id?: string }).id ?? "")} />} />
              </li>
            ))}
          </ul>
        </Card>
      ) : tab === "instances" ? (
        <Card title="Agent instances">
          <ul className="grid gap-2 sm:grid-cols-2">
            {q.data.agent_instances.map((instance) => (
              <li key={instance.id} className="rounded-md border border-white/5 bg-white/[0.02] p-3">
                <KV label="Status" value={<StatusPill tone={statusTone(String(instance.status ?? ""))}>{String(instance.status ?? "—")}</StatusPill>} />
                <KV label="Created" value={<TimeAgo iso={instance.created_at} />} />
                <KV label="ID" value={<CopyableId value={instance.id} />} />
              </li>
            ))}
          </ul>
        </Card>
      ) : tab === "presence" ? (
        <Card title="Presence" actions={<ChainIntegrityBadge count={q.data.presence.length} label="records" />}>
          <ul className="grid gap-2 sm:grid-cols-2">
            {q.data.presence.map((row) => {
              const r = row as { id: number | string; device_id: string; last_heartbeat_at: string };
              return (
                <li key={r.id} className="rounded-md border border-white/5 bg-white/[0.02] p-3">
                  <KV label="Device ID" value={<CopyableId value={r.device_id} prefix={12} />} />
                  <KV label="Last heartbeat" value={<TimeAgo iso={r.last_heartbeat_at} />} />
                </li>
              );
            })}
          </ul>
        </Card>
      ) : tab === "tasks" ? (
        <Card title="Tasks">
          <ul className="grid gap-2 sm:grid-cols-2">
            {q.data.relay_tasks.map((task) => (
              <li key={task.id} className="rounded-md border border-white/5 bg-white/[0.02] p-3">
                <KV label="Status" value={<StatusPill tone={statusTone(task.status)}>{task.status}</StatusPill>} />
                <KV label="From" value={<CopyableId value={task.from_agent_instance_id} prefix={10} />} />
                <KV label="To" value={<CopyableId value={task.to_agent_instance_id} prefix={10} />} />
                <KV label="Created" value={<TimeAgo iso={task.created_at} />} />
              </li>
            ))}
          </ul>
        </Card>
      ) : tab === "transfers" ? (
        <Card title="Transfers">
          <ul className="grid gap-2 sm:grid-cols-2">
            {q.data.file_transfers.map((transfer) => (
              <li key={transfer.id} className="rounded-md border border-white/5 bg-white/[0.02] p-3">
                <KV label="File" value={transfer.file_name} />
                <KV label="Status" value={<StatusPill tone={statusTone(transfer.status)}>{transfer.status}</StatusPill>} />
                <KV label="SHA-256" value={<CopyableId value={transfer.sha256} prefix={12} />} />
                <KV label="Expires" value={<TimeAgo iso={transfer.expires_at} />} />
              </li>
            ))}
          </ul>
        </Card>
      ) : (
        <Card title="Audit events" actions={<ChainIntegrityBadge count={q.data.audit_events.length} label="events" />}>
          <ul className="grid gap-1.5">
            {q.data.audit_events.map((event) => (
              <li key={event.id} className="flex items-center justify-between gap-2 rounded-md border border-white/5 bg-white/[0.02] px-3 py-2 text-[11px]">
                <span className="font-mono text-white/85">{event.event_type}</span>
                <span className="text-white/45"><TimeAgo iso={event.created_at} /></span>
                <CopyableId value={event.event_hash} />
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
};
