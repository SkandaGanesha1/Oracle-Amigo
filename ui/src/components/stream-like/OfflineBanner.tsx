import { WifiOff, RefreshCw } from "lucide-react";

interface OfflineBannerProps {
  message?: string;
  onRetry?: () => void;
}

export function OfflineBanner({
  message = "You appear to be offline. Messages will be sent when you reconnect.",
  onRetry,
}: OfflineBannerProps) {
  return (
    <div
      className="flex items-center gap-3 border-b border-oa-amber/20 bg-oa-amber/10 px-4 py-2"
      role="alert"
      aria-live="polite"
    >
      <WifiOff className="h-4 w-4 shrink-0 text-oa-amber" />
      <p className="flex-1 text-xs text-oa-amber">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="flex shrink-0 items-center gap-1 rounded-md bg-oa-amber/20 px-2 py-1 text-[10px] font-medium text-oa-amber transition-colors hover:bg-oa-amber/30"
        >
          <RefreshCw className="h-3 w-3" />
          Retry
        </button>
      )}
    </div>
  );
}
