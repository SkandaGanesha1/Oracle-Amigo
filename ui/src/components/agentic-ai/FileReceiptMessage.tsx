import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Shield, ShieldAlert, User, HardDrive, Clock, Ban, BadgeCheck, ExternalLink, Eye, FileText, Loader2, CheckCircle2 } from "lucide-react";
import type { FileReceiptMessage as FileReceiptMessageType } from "../../api/types";
import { usePendingApprovals, useConsentAction } from "../../hooks/queries";
import { PrivacyBadge } from "../../components/primitives/PrivacyBadge";

interface FileReceiptMessageProps {
  message: FileReceiptMessageType;
}

function formatAccessExpiry(now: number, receivedAt: string, expiresInHours = 24): string {
  const received = new Date(receivedAt).getTime();
  const expiresAt = received + expiresInHours * 60 * 60 * 1000;
  const remaining = expiresAt - now;
  if (remaining <= 0) return "Expired";
  const hours = Math.floor(remaining / (60 * 60 * 1000));
  const minutes = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

const AGENT_ID_RE = /^ag[ei]_[a-f0-9-]{36,}$/i;

function formatAgentName(id: string): string {
  if (AGENT_ID_RE.test(id.trim())) return "Remote agent";
  return id;
}

export function FileReceiptMessage({ message }: FileReceiptMessageProps) {
  const now = Date.now();
  const navigate = useNavigate();
  const accessExpiry = formatAccessExpiry(now, message.received_at);
  const { approvalCards } = usePendingApprovals();
  const consentAction = useConsentAction();
  const [confirmingRevoke, setConfirmingRevoke] = useState(false);
  const [revoked, setRevoked] = useState(false);
  const recipientLabel = formatAgentName(message.sender);

  const matchingApproval = approvalCards.find(
    (a) => a.task_id === message.task_id
  );

  const handleRevoke = useCallback(() => {
    if (!matchingApproval) return;
    consentAction.mutate(
      { consentId: matchingApproval.approval_id, action: "revoke" },
      { onSuccess: () => setRevoked(true), onSettled: () => setConfirmingRevoke(false) }
    );
  }, [matchingApproval, consentAction]);

  const handleNavigateAudit = useCallback(() => {
    navigate(`/audit?q=${encodeURIComponent(message.file_name)}`);
  }, [navigate, message.file_name]);

  const canRevoke = !revoked && matchingApproval;
  const isProcessing = consentAction.isPending;

  return (
    <div className="rounded-xl card-transfer-result border p-4" role="region" aria-label={`File transfer receipt: ${message.file_name}`}>
      <div className="flex items-start gap-3">
        <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${message.hash_verified ? "bg-oa-green/10" : "bg-oa-amber/10"}`}>
          {message.hash_verified
            ? <Shield className="card-icon h-4 w-4" />
            : <ShieldAlert className="card-icon h-4 w-4" />
          }
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-oa-text-muted">
              Sent securely
            </h3>
            <div className="flex items-center gap-1.5">
              <PrivacyBadge boundary="shared-externally" />
              {canRevoke && <PrivacyBadge boundary="revocable" />}
              <span className="inline-flex items-center gap-0.5 rounded bg-oa-green/10 px-1.5 py-0.5 text-[9px] text-oa-green">
                <BadgeCheck className="h-2.5 w-2.5" />
                Agent verified
              </span>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                message.hash_verified
                  ? "bg-oa-green/10 text-oa-green"
                  : "bg-oa-amber/10 text-oa-amber"
              }`}>
                {message.hash_verified ? "Verified" : "Needs Review"}
              </span>
            </div>
          </div>
          <p className="mt-1 text-sm font-medium text-oa-text">{message.file_name}</p>
          <p className="text-[11px] text-oa-text-muted">{formatSize(message.size_bytes)}</p>

          <div className="mt-2 flex items-center gap-1.5 text-[10px] text-oa-amber">
            <Clock className="h-3 w-3" />
            <span>Access expires in {accessExpiry}</span>
          </div>

          <div className="mt-3 space-y-1.5">
            <div className="flex items-center gap-2 text-xs text-oa-text-muted">
              <User className="h-3 w-3" />
              <span>Sent to <span className="font-medium text-oa-text">{recipientLabel}</span>&rsquo;s verified agent</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-oa-text-muted">
              <HardDrive className="h-3 w-3" />
              <span className="truncate min-w-0">{message.stored_path_display}</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-oa-text-muted">
              <FileText className="h-3 w-3" />
              <span>Access type: Time-bound &middot; {accessExpiry} remaining</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-oa-green">
              <CheckCircle2 className="h-3 w-3" />
              <span>Transfer completed successfully</span>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-lg border border-oa-blue/30 bg-oa-blue/5 px-3 py-1.5 text-[11px] font-medium text-oa-blue transition hover:bg-oa-blue/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue"
            >
              <Eye className="h-3.5 w-3.5" />
              Preview
            </button>
            <button
              type="button"
              onClick={handleNavigateAudit}
              className="inline-flex items-center gap-1.5 rounded-lg border border-oa-border bg-oa-surface-2 px-3 py-1.5 text-[11px] font-medium text-oa-text-muted transition hover:bg-oa-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Audit entry
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-lg border border-oa-border bg-oa-surface-2 px-3 py-1.5 text-[11px] font-medium text-oa-text-muted transition hover:bg-oa-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Audit entry
            </button>
            {canRevoke && !confirmingRevoke && (
              <button
                type="button"
                onClick={() => setConfirmingRevoke(true)}
                disabled={isProcessing}
                className="inline-flex items-center gap-1.5 rounded-lg border border-oa-red/30 bg-oa-red/5 px-3 py-1.5 text-[11px] font-medium text-oa-red transition hover:bg-oa-red/10 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue"
              >
                <Ban className="h-3.5 w-3.5" />
                Revoke access
              </button>
            )}
            {canRevoke && confirmingRevoke && (
              <div className="flex w-full items-center gap-2 rounded-lg border border-oa-red/20 bg-oa-red/5 p-2 text-[10px] text-oa-red">
                <span>Revoking will prevent {recipientLabel} from accessing this file.</span>
                <button
                  type="button"
                  onClick={handleRevoke}
                  disabled={isProcessing}
                  className="ml-auto shrink-0 rounded bg-oa-red px-2 py-1 text-white hover:bg-oa-red/80 disabled:opacity-50"
                >
                  {isProcessing ? <Loader2 className="h-3 w-3 animate-spin" /> : "Confirm revoke"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingRevoke(false)}
                  disabled={isProcessing}
                  className="shrink-0 rounded bg-oa-surface-2 px-2 py-1 text-oa-text-muted hover:text-oa-text disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            )}
            {revoked && (
              <div className="flex w-full items-center gap-2 rounded-lg border border-oa-green/20 bg-oa-green/5 p-2 text-[10px] text-oa-green">
                <BadgeCheck className="h-3 w-3" />
                Access revoked
              </div>
            )}
            {!canRevoke && !revoked && (
              <span className="text-[10px] text-oa-text-disabled">No active consent to revoke</span>
            )}
          </div>

          {!message.hash_verified && (
            <div className="mt-3 rounded-lg border border-oa-amber/20 bg-oa-amber/5 p-2 text-[10px] text-oa-amber">
              Hash verification failed. The file may have been tampered with during transfer.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
