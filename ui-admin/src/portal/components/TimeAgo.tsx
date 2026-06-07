import type { FC } from "react";

export const TimeAgo: FC<{ iso: string | null | undefined; fallback?: string }> = ({ iso, fallback = "—" }) => {
  if (!iso) return <span className="text-white/40">{fallback}</span>;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return <span className="text-white/40">{fallback}</span>;
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  return (
    <span title={date.toISOString()} className="tabular-nums">
      {formatRelative(seconds)} ago
    </span>
  );
};

function formatRelative(seconds: number): string {
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  const days = Math.floor(seconds / 86400);
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo`;
  return `${Math.floor(months / 12)}y`;
}
