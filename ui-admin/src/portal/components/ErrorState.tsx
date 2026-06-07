import { AlertTriangle, RotateCw } from "lucide-react";
import type { FC, ReactNode } from "react";

interface ErrorStateProps {
  title?: string;
  error: unknown;
  onRetry?: () => void;
  details?: ReactNode;
}

export const ErrorState: FC<ErrorStateProps> = ({ title = "Something went wrong", error, onRetry, details }) => {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "Unknown error";
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-rose-400/30 bg-rose-500/10 p-6 text-center text-rose-100">
      <AlertTriangle className="h-5 w-5" />
      <p className="text-sm font-semibold">{title}</p>
      <p className="max-w-md text-xs text-rose-200/80">{message}</p>
      {details && <div className="mt-1 text-[11px] text-rose-200/70">{details}</div>}
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-1.5 rounded-md border border-rose-300/30 bg-rose-400/20 px-3 py-1.5 text-xs text-rose-50 hover:bg-rose-400/30"
        >
          <RotateCw className="h-3 w-3" /> Retry
        </button>
      )}
    </div>
  );
};
