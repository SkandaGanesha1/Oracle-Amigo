import { Check, X, Clock, RefreshCw } from "lucide-react";

interface ApprovalTerminalStateProps {
  status: "approved" | "rejected" | "expired" | "feedback" | "feedback_requested" | "feedback_received" | "decision_pending";
  feedbackText?: string | null;
  expiresAt?: string;
}

const stateConfig: Record<string, { icon: typeof Check; color: string; bg: string; label: string }> = {
  approved: { icon: Check, color: "text-oa-green", bg: "bg-oa-green/10", label: "Approved" },
  rejected: { icon: X, color: "text-oa-red", bg: "bg-oa-red/10", label: "Rejected" },
  expired: { icon: Clock, color: "text-oa-text-muted", bg: "bg-oa-surface-2", label: "Expired" },
  feedback_requested: { icon: RefreshCw, color: "text-oa-blue", bg: "bg-oa-blue/10", label: "Feedback Requested" },
  feedback_received: { icon: RefreshCw, color: "text-oa-purple", bg: "bg-oa-purple/10", label: "Feedback Received" },
  feedback: { icon: RefreshCw, color: "text-oa-amber", bg: "bg-oa-amber/10", label: "Feedback" },
  decision_pending: { icon: Clock, color: "text-oa-amber", bg: "bg-oa-amber/10", label: "Processing..." },
};

export function ApprovalTerminalState({ status, feedbackText, expiresAt }: ApprovalTerminalStateProps) {
  const config = stateConfig[status] ?? stateConfig.expired;
  const Icon = config.icon;

  return (
    <div className={`rounded-lg border ${config.bg} p-3 ${config.color.replace("text-", "border-").replace("oa-green", "oa-green/20").replace("oa-red", "oa-red/20").replace("oa-blue", "oa-blue/20").replace("oa-amber", "oa-amber/20").replace("oa-purple", "oa-purple/20").replace("oa-text-muted", "oa-border")}`}>
      <div className="flex items-start gap-2.5">
        <Icon className={`mt-0.5 h-4 w-4 ${config.color}`} />
        <div className="space-y-1">
          <p className={`text-xs font-medium ${config.color}`}>{config.label}</p>
          {feedbackText && (
            <p className="text-[10px] text-oa-text-muted leading-relaxed">
              Feedback: &ldquo;{feedbackText}&rdquo;
            </p>
          )}
          {expiresAt && status === "expired" && (
            <p className="text-[10px] text-oa-text-disabled">
              Expired {new Date(expiresAt).toLocaleString()}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
