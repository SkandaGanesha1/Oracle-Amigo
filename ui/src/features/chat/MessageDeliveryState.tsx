import { useState } from "react";
import { Check, Loader2, WifiOff, AlertCircle, Users } from "lucide-react";
import type { DeliveryStatus } from "../../api/types";

interface MessageDeliveryStateProps {
  status: DeliveryStatus;
  onRetry?: () => void;
  onCancel?: () => void;
  failureReason?: string;
  avatarStack?: Array<{ initials: string; seed: string }>;
  offlineCount?: number;
}

function failureMessage(reason?: string): string {
  if (reason === "relay_unavailable") return "Not delivered — Remote agent is offline. Message will send when the agent reconnects.";
  if (reason === "timeout") return "Not delivered — Request timed out. Try again.";
  if (reason === "rejected") return "Not delivered — Message was rejected by the server.";
  if (reason) return `Not delivered — ${reason}`;
  return "Not delivered — Could not reach the remote agent. Check your connection and try again.";
}

const statusConfig: Record<DeliveryStatus, { icon: typeof Check; label: string; color: string; animate?: boolean }> = {
  local_pending: { icon: Loader2, label: "Sending...", color: "text-oa-text-muted", animate: true },
  sent: { icon: Check, label: "Sent", color: "text-oa-text-muted" },
  delivered: { icon: Check, label: "Delivered", color: "text-oa-green" },
  failed: { icon: WifiOff, label: "Not delivered", color: "text-oa-amber" },
};

export function MessageDeliveryState({ status, onRetry, onCancel, failureReason, avatarStack, offlineCount }: MessageDeliveryStateProps) {
  const config = statusConfig[status];
  const Icon = config.icon;
  const [showDetails, setShowDetails] = useState(false);

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-1.5">
        {avatarStack && avatarStack.length > 0 && (
          <div className="flex -space-x-1.5 mr-1">
            {avatarStack.map((avatar, i) => (
              <div
                key={avatar.seed}
                className="flex h-5 w-5 items-center justify-center rounded-full bg-oa-surface-2 ring-1 ring-oa-bg text-[7px] font-medium text-oa-text-muted"
                style={{ zIndex: avatarStack.length - i }}
                title={avatar.seed}
              >
                {avatar.initials}
              </div>
            ))}
            {offlineCount && offlineCount > 0 ? (
              <div className="flex h-5 w-5 items-center justify-center rounded-full bg-oa-amber/20 text-[8px] font-medium text-oa-amber ring-1 ring-oa-bg">
                {offlineCount}
              </div>
            ) : (
              avatarStack.length > 1 && (
                <div className="flex h-5 w-5 items-center justify-center rounded-full bg-oa-surface-2 text-[8px] font-medium text-oa-text-muted ring-1 ring-oa-bg">
                  <Users className="h-2.5 w-2.5" />
                </div>
              )
            )}
          </div>
        )}

        <Icon className={`h-3 w-3 ${config.color} ${config.animate ? "animate-spin" : ""}`} />
        <span className={`text-[10px] ${config.color}`}>{config.label}</span>

        {offlineCount && offlineCount > 0 && !avatarStack && (
          <span className="rounded bg-oa-amber/10 px-1.5 py-0.5 text-[9px] text-oa-amber font-medium">
            {offlineCount} queued
          </span>
        )}

        {status === "failed" && (
          <>
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="min-h-[48px] px-1 text-[10px] text-oa-blue underline transition-colors hover:text-oa-cyan focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue focus-visible:ring-offset-2"
              >
                Retry
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowDetails(!showDetails)}
              aria-expanded={showDetails}
              className="min-h-[48px] px-1 text-[10px] text-oa-text-muted underline transition-colors hover:text-oa-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue focus-visible:ring-offset-2"
            >
              Details
            </button>
            {onCancel && (
              <button
                type="button"
                onClick={onCancel}
                className="min-h-[48px] px-1 text-[10px] text-oa-amber underline transition-colors hover:text-oa-red focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue focus-visible:ring-offset-2"
              >
                Cancel
              </button>
            )}
          </>
        )}
      </div>
      {status === "failed" && showDetails && (
        <div className="flex items-start gap-1.5 rounded-md bg-oa-surface px-2 py-1.5 max-w-[260px]">
          <AlertCircle className="h-3 w-3 shrink-0 mt-0.5 text-oa-amber" />
          <p className="text-[10px] text-oa-text-muted leading-relaxed">{failureMessage(failureReason)}</p>
        </div>
      )}
    </div>
  );
}
