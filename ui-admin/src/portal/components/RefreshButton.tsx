import { RefreshCw } from "lucide-react";
import type { FC } from "react";

interface RefreshButtonProps {
  onClick: () => void;
  isFetching?: boolean;
  label?: string;
}

export const RefreshButton: FC<RefreshButtonProps> = ({ onClick, isFetching, label = "Refresh" }) => (
  <button
    type="button"
    onClick={onClick}
    className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-[11px] text-white/70 transition hover:bg-white/10 hover:text-white"
  >
    <RefreshCw className={`h-3 w-3 ${isFetching ? "animate-spin" : ""}`} />
    {label}
  </button>
);
