import { ChevronDown } from "lucide-react";

interface UnreadDividerProps {
  label?: string;
  count?: number;
  onJumpToLatest?: () => void;
}

export function UnreadDivider({ label = "New messages", count, onJumpToLatest }: UnreadDividerProps) {
  return (
    <div className="group flex items-center gap-3 px-4 py-1.5">
      <div className="flex flex-1 items-center gap-3" role="separator" aria-label={label}>
        <div className="flex-1 border-t border-oa-blue/40" />
        <div className="flex items-center gap-2">
          <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wider text-oa-blue">
            {label}
          </span>
          {count !== undefined && count > 0 && (
            <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-oa-blue/20 px-1 text-[9px] font-medium text-oa-blue">
              {count}
            </span>
          )}
        </div>
        <div className="flex-1 border-t border-oa-blue/40" />
      </div>
      {onJumpToLatest && (
        <button
          type="button"
          onClick={onJumpToLatest}
          className="ml-2 flex min-h-[48px] min-w-[48px] items-center justify-center rounded-md text-oa-blue opacity-0 transition-opacity hover:bg-oa-blue/10 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue group-hover:opacity-100"
          aria-label="Jump to latest messages"
          title="Jump to latest"
        >
          <ChevronDown className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
