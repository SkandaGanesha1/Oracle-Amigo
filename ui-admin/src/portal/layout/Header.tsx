import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Server, Activity } from "lucide-react";
import { useEffect, useState, type FC } from "react";
import { fetchAdminInfo, type AdminInfo } from "../api/queries";
import { ThemeToggle } from "./ThemeToggle";
import { TimeAgo } from "../components/TimeAgo";

export const Header: FC = () => {
  const [now, setNow] = useState<number>(() => Date.now());
  const queryClient = useQueryClient();

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const info = useQuery<AdminInfo>({
    queryKey: ["admin", "info"],
    queryFn: fetchAdminInfo,
    refetchInterval: 15_000
  });

  const handleRefreshAll = () => {
    void info.refetch();
    void queryClient.invalidateQueries({ queryKey: ["admin"] });
  };

  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-white/10 bg-[#070708]/60 px-4 backdrop-blur">
      <div className="flex items-center gap-3">
        <h1 className="text-sm font-semibold text-white">Control Plane Monitor</h1>
        <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-wider text-white/55">
          {info.data ? info.data.env : "…"}
        </span>
        <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-wider text-white/55">
          v{info.data ? info.data.version : "—"}
        </span>
      </div>
      <div className="flex items-center gap-2">
        {info.data && (
          <span
            className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white/70"
            title={`Server started ${new Date(now - info.data.uptimeSeconds * 1000).toISOString()}`}
          >
            <Activity className="h-3 w-3 text-emerald-300" />
            uptime {formatDuration(info.data.uptimeSeconds, now)}
          </span>
        )}
        <button
          type="button"
          onClick={handleRefreshAll}
          className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white/70 transition hover:bg-white/10 hover:text-white"
          title="Refresh all queries"
        >
          <RefreshCw className={`h-3 w-3 ${info.isFetching ? "animate-spin" : ""}`} />
          Refresh
        </button>
        <ThemeToggle />
        {info.dataUpdatedAt > 0 && (
          <span className="hidden items-center gap-1.5 rounded-md border border-white/5 px-2 py-1 text-[10px] text-white/40 md:inline-flex">
            <Server className="h-3 w-3" />
            <TimeAgo iso={new Date(info.dataUpdatedAt).toISOString()} />
          </span>
        )}
      </div>
    </header>
  );
};

function formatDuration(seconds: number, now: number): string {
  const startedAt = now - seconds * 1000;
  const deltaSec = Math.max(0, Math.floor((now - startedAt) / 1000));
  if (deltaSec < 60) return `${deltaSec}s`;
  if (deltaSec < 3600) return `${Math.floor(deltaSec / 60)}m ${deltaSec % 60}s`;
  const h = Math.floor(deltaSec / 3600);
  const m = Math.floor((deltaSec % 3600) / 60);
  return `${h}h ${m}m`;
}
