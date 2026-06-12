import { useState } from "react";
import { AlertCircle, Check, CheckCheck, Clock3, Loader2, Server, Users, WifiOff } from "lucide-react";
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
  if (reason === "stale_route") return "Not delivered - this chat targets an old agent route. Switch to the current agent and retry.";
  if (reason === "relay_unavailable") return "Not delivered - remote agent is offline. Message will send when the agent reconnects.";
  if (reason === "timeout") return "Not delivered - request timed out. Try again.";
  if (reason === "rejected") return "Not delivered - message was rejected by the server.";
  if (reason) return `Not delivered - ${reason}`;
  return "Not delivered - could not reach the remote agent. Check your connection and try again.";
}

const statusConfig: Record<DeliveryStatus, { icon: typeof Check; label: string; color: string; animate?: boolean }> = {
  local_pending: { icon: Loader2, label: "Sending...", color: "text-oa-text-muted", animate: true },
  queued_at_relay: { icon: Clock3, label: "Queued at relay", color: "text-oa-text-muted" },
  delivered_to_remote_agent: { icon: Server, label: "Delivered to remote agent", color: "text-oa-cyan" },
  stored_by_remote_agent: { icon: CheckCheck, label: "Stored by remote agent", color: "text-oa-green" },
  read_by_remote_user: { icon: CheckCheck, label: "Seen", color: "text-oa-green" },
  sent: { icon: Check, label: "Sent", color: "text-oa-text-muted" },
  delivered: { icon: Check, label: "Delivered", color: "text-oa-green" },
  failed: { icon: WifiOff, label: "Not delivered", color: "text-oa-amber" },
};

export function MessageDeliveryState({ status, onRetry, onCancel, failureReason, avatarStack, offlineCount }: MessageDeliveryStateProps) {
  const config = statusConfig[status] ?? statusConfig.local_pending;
  const Icon = config.icon;
  const [showDetails, setShowDetails] = useState(false);

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-1.5">
        {avatarStack && avatarStack.length > 0 && (
          <div className="mr-1 flex -space-x-1.5">
            {avatarStack.map((avatar, i) => (
              <div
                key={avatar.seed}
                className="flex h-5 w-5 items-center justify-center rounded-full bg-oa-surface-2 text-[7px] font-medium text-oa-text-muted ring-1 ring-oa-bg"
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
          <span className="rounded bg-oa-amber/10 px-1.5 py-0.5 text-[9px] font-medium text-oa-amber">
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
                {failureReason === "stale_route" ? "Switch and retry" : "Retry"}
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
        <div className="flex max-w-[260px] items-start gap-1.5 rounded-md bg-oa-surface px-2 py-1.5">
          <AlertCircle className="mt-0.5 h-3 w-3 shrink-0 text-oa-amber" />
          <p className="text-[10px] leading-relaxed text-oa-text-muted">{failureMessage(failureReason)}</p>
        </div>
      )}
    </div>
  );
}
