import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BadgeCheck, Ban, ExternalLink, Loader2, ShieldAlert } from "lucide-react";
import { DocumentPreviewCard, PreviewButton, type ChatDocumentPreview } from "../stream-like/DocumentPreviewCard";
import type { FileReceiptMessage as FileReceiptMessageType } from "../../api/types";
import { usePendingApprovals, useConsentAction } from "../../hooks/queries";

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

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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

  const matchingApproval = approvalCards.find((approval) => approval.task_id === message.task_id);

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

  const file: ChatDocumentPreview = {
    id: message.file_id,
    name: message.file_name,
    mimeType: "file",
    sizeLabel: formatSize(message.size_bytes),
    status: message.hash_verified ? "received" : "blocked",
    verified: message.hash_verified,
  };

  return (
    <section className="oa-agent-card" role="region" aria-label={`File receipt: ${message.file_name}`}>
      <div className="oa-agent-card-header">
        <div className="min-w-0">
          <div className="oa-agent-card-kicker">Secure file receipt</div>
          <h3 className="oa-agent-card-title">{message.hash_verified ? "File shared successfully" : "Verification needs review"}</h3>
          <p className="oa-agent-card-subtitle">Sent to {recipientLabel}&rsquo;s verified agent · Access {accessExpiry}</p>
        </div>
        <span className={`oa-doc-chip ${message.hash_verified ? "success" : "warning"}`}>
          {message.hash_verified ? "Verified" : "Needs review"}
        </span>
      </div>

      <DocumentPreviewCard
        file={file}
        secondaryAction={<PreviewButton />}
        primaryAction={
          <button type="button" onClick={handleNavigateAudit} className="oa-doc-action">
            <ExternalLink size={16} aria-hidden="true" />
            Audit entry
          </button>
        }
      />

      <div className="oa-agent-card-panel">
        <div className="oa-doc-chip-row">
          <span className="oa-doc-chip">Recipient: {recipientLabel}</span>
          <span className="oa-doc-chip">Time-bound access</span>
          <span className="oa-doc-chip warning">Expires: {accessExpiry}</span>
        </div>
      </div>

      {canRevoke && !confirmingRevoke && (
        <button
          type="button"
          onClick={() => setConfirmingRevoke(true)}
          disabled={isProcessing}
          className="oa-doc-action danger"
        >
          <Ban size={16} aria-hidden="true" />
          Revoke access
        </button>
      )}

      {canRevoke && confirmingRevoke && (
        <div className="oa-agent-card-panel text-xs text-oa-red">
          <span>Revoking will prevent {recipientLabel} from accessing this file.</span>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={handleRevoke}
              disabled={isProcessing}
              className="oa-doc-action danger"
            >
              {isProcessing ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Ban size={16} aria-hidden="true" />}
              Confirm revoke
            </button>
            <button
              type="button"
              onClick={() => setConfirmingRevoke(false)}
              disabled={isProcessing}
              className="oa-doc-action"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {revoked && (
        <div className="oa-agent-card-panel text-xs text-oa-green">
          <BadgeCheck size={14} aria-hidden="true" />
          Access revoked
        </div>
      )}

      {!message.hash_verified && (
        <div className="oa-agent-card-panel text-xs text-oa-amber">
          <ShieldAlert size={14} aria-hidden="true" />
          Hash verification failed. The file may have changed during transfer.
        </div>
      )}
    </section>
  );
}
