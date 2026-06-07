import { ShieldCheck, ShieldAlert } from "lucide-react";
import type { FC } from "react";

interface ChainIntegrityBadgeProps {
  count: number;
  label?: string;
}

export const ChainIntegrityBadge: FC<ChainIntegrityBadgeProps> = ({ count, label = "events" }) => {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-md border border-emerald-400/20 bg-emerald-400/10 px-2 py-0.5 text-[10px] text-emerald-200"
      title="Hash chain is independently verifiable client-side."
    >
      <ShieldCheck className="h-3 w-3" />
      {count} {label}
    </span>
  );
};

export const ChainBrokenBadge: FC<{ at: number | string }> = ({ at }) => (
  <span className="inline-flex items-center gap-1.5 rounded-md border border-rose-400/30 bg-rose-500/10 px-2 py-0.5 text-[10px] text-rose-200">
    <ShieldAlert className="h-3 w-3" />
    broken at {at}
  </span>
);
