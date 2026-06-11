import { Card } from "../components/Card";
import { Skeleton } from "../components/Skeleton";
import { useAdminInfo, useAdminUsers, useAdminDevices, useAdminAgentInstances, useAdminPresence, useAdminTasks, useAdminTransfers, useAdminAudit } from "../api/queries";
import { TimeAgo } from "../components/TimeAgo";
import { StatusPill, statusTone } from "../components/StatusPill";
import { CopyableId } from "../components/CopyableId";
import { Users2, Cpu, Boxes, ScrollText, FileLock2, History, Activity, Network } from "lucide-react";
import type { FC } from "react";

function useKpis(refetchInterval = 5_000) {
  return {
    info: useAdminInfo(),
    users: useAdminUsers({ refetchInterval }),
    devices: useAdminDevices({ refetchInterval }),
    instances: useAdminAgentInstances({ refetchInterval }),
    presence: useAdminPresence({ refetchInterval }),
    tasks: useAdminTasks({ refetchInterval }),
    transfers: useAdminTransfers({ refetchInterval }),
    audit: useAdminAudit({ refetchInterval: refetchInterval * 2 })
  };
}

export const OverviewPage: FC = () => {
  const k = useKpis();

  const isLoading =
    k.users.isLoading || k.devices.isLoading || k.instances.isLoading || k.presence.isLoading || k.tasks.isLoading || k.transfers.isLoading || k.audit.isLoading;

  const onlineDevices = (k.presence.data ?? []).filter((row) => String(row.status ?? "").toLowerCase() === "online").length;

  const openTasks = (k.tasks.data ?? []).filter((row) => {
    const s = String(row.status ?? "").toLowerCase();
    return s !== "completed" && s !== "delivered" && s !== "failed" && s !== "canceled" && s !== "expired";
  }).length;

  const activeTransfers = (k.transfers.data ?? []).filter((row) => {
    const s = String(row.status ?? "").toLowerCase();
    return s !== "completed" && s !== "delivered" && s !== "expired" && s !== "failed";
  }).length;

  const latestAudit = (k.audit.data ?? [])[0];
  const topPresence = (k.presence.data ?? [])
    .slice()
    .sort((a, b) => new Date(b.last_heartbeat_at).getTime() - new Date(a.last_heartbeat_at).getTime())
    .slice(0, 10);

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-base font-semibold text-white">Overview</h1>
          <p className="text-xs text-white/55">Live snapshot of the control plane. Auto-refresh every 5 seconds.</p>
        </div>
        {isLoading && <span className="text-[11px] text-white/40">loading…</span>}
      </header>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        <Kpi icon={<Users2 className="h-4 w-4" />} label="Users" value={k.users.data?.length ?? 0} />
        <Kpi icon={<Cpu className="h-4 w-4" />} label="Devices" value={k.devices.data?.length ?? 0} />
        <Kpi icon={<Boxes className="h-4 w-4" />} label="Instances" value={k.instances.data?.length ?? 0} />
        <Kpi icon={<Activity className="h-4 w-4" />} label="Online" value={onlineDevices} accent />
        <Kpi icon={<ScrollText className="h-4 w-4" />} label="Open tasks" value={openTasks} />
        <Kpi icon={<FileLock2 className="h-4 w-4" />} label="Active transfers" value={activeTransfers} />
        <Kpi icon={<History className="h-4 w-4" />} label="Audit events" value={k.audit.data?.length ?? 0} />
      </section>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card title="Recent activity" description="Latest 25 audit events.">
          {k.audit.isLoading ? (
            <Skeleton rows={5} />
          ) : !k.audit.data || k.audit.data.length === 0 ? (
            <p className="py-6 text-center text-xs text-white/45">No audit events yet.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {k.audit.data.slice(0, 25).map((event) => (
                <li key={event.id} className="flex items-center justify-between gap-3 rounded-md border border-white/5 bg-white/[0.02] px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs text-white">
                      <span className="font-mono text-white/55">{event.event_type}</span>
                    </p>
                    <p className="truncate text-[11px] text-white/45">
                      <TimeAgo iso={event.created_at} />
                      {event.actor_user_id ? ` · user ${String(event.actor_user_id).slice(0, 8)}…` : null}
                      {event.actor_agent_instance_id ? ` · agent ${String(event.actor_agent_instance_id).slice(0, 8)}…` : null}
                    </p>
                  </div>
                  <CopyableId value={event.event_hash} />
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Live presence" description="Devices ordered by last heartbeat.">
          {k.presence.isLoading ? (
            <Skeleton rows={5} />
          ) : topPresence.length === 0 ? (
            <p className="py-6 text-center text-xs text-white/45">No presence reported yet.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {topPresence.map((row) => {
                const status = String(row.status ?? "").toLowerCase();
                const ageSec = Math.max(0, Math.floor((Date.now() - new Date(row.last_heartbeat_at).getTime()) / 1000));
                const tone = status === "online" ? "green" : status === "stale" || ageSec < 300 ? "amber" : "red";
                return (
                  <li key={row.id} className="flex items-center justify-between gap-3 rounded-md border border-white/5 bg-white/[0.02] px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs text-white">
                        <span className="font-medium">{row.device_name ?? "(unnamed device)"}</span>{" "}
                        <span className="text-white/45">— {row.owner_email ?? "—"}</span>
                      </p>
                      <p className="text-[11px] text-white/40">
                        <TimeAgo iso={row.last_heartbeat_at} />
                      </p>
                    </div>
                    <StatusPill tone={statusTone(tone === "green" ? "online" : tone === "amber" ? "stale" : "offline")}>
                      {tone === "green" ? "online" : tone === "amber" ? "stale" : "offline"}
                    </StatusPill>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      {!k.info.data && (
        <Card title="Control plane not reachable">
          <p className="text-xs text-white/55">
            The header could not fetch <code className="rounded bg-black/40 px-1">/v1/admin/info</code>. Confirm the
            control plane is running on the configured port and your token matches <code>DEV_ADMIN_TOKEN</code>.
          </p>
        </Card>
      )}

      {k.info.data && (
        <Card title="Control plane" description="Self-reported server info.">
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-white/40">Environment</p>
              <p className="mt-0.5 inline-flex items-center gap-1.5 text-sm text-white">
                <Network className="h-3.5 w-3.5 text-emerald-300" />
                {k.info.data.env}
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-white/40">Version</p>
              <p className="mt-0.5 font-mono text-sm text-white">v{k.info.data.version}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-white/40">Uptime</p>
              <p className="mt-0.5 text-sm text-white">{Math.floor(k.info.data.uptimeSeconds / 60)} min</p>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
};

const Kpi: FC<{ icon: React.ReactNode; label: string; value: number; accent?: boolean }> = ({ icon, label, value, accent }) => (
  <div
    className={`rounded-2xl border p-3 ${
      accent ? "border-emerald-400/30 bg-emerald-400/5" : "border-white/10 bg-[#0b0b0d]/80"
    }`}
  >
    <div className="flex items-center gap-2 text-white/45">
      {icon}
      <p className="text-[10px] uppercase tracking-wider">{label}</p>
    </div>
    <p className="mt-2 text-2xl font-semibold tabular-nums text-white">{value}</p>
  </div>
);
