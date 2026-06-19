import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CheckCircle2, ExternalLink, FolderOpen, Search, Shield, X } from "lucide-react";
import { DocumentPreviewCard, PreviewButton, type ChatDocumentPreview } from "../stream-like/DocumentPreviewCard";
import { useApproveFileRequest, useIndexedFiles, useRebindApprovalFile, useRejectFileRequest, useSubmitApprovalFeedback } from "../../hooks/queries";
import { BiometricApproveButton } from "../../features/approvals/BiometricApproveButton";
import type { FileCandidateApprovalMessage, CandidateFile } from "../../api/types";

const AGENT_ID_RE = /^ag[ei][_-]/i;

function formatRequester(id: string): string {
  if (AGENT_ID_RE.test(id.trim())) return "Remote agent";
  if (/^me$/i.test(id.trim()) || id.trim() === "You") return "You";
  return id;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function decodeFileName(name: string): string {
  try {
    return decodeURIComponent(name);
  } catch {
    return name.replace(/%20/g, " ");
  }
}

function candidateToPreview(file: CandidateFile | undefined, status: FileCandidateApprovalMessage["card"]["status"]): ChatDocumentPreview {
  if (!file) {
    return {
      id: "missing-candidate",
      name: "No matching file selected",
      mimeType: "unknown",
      status: "pending_approval",
      sensitivity: "medium",
      leavesDevice: true,
    };
  }
  return {
    id: file.candidate_id,
    name: file.file_name,
    mimeType: file.extension ? `.${file.extension}` : "unknown",
    sizeLabel: formatSize(file.size_bytes),
    matchLabel: file.match_reason || "Exact filename match",
    status: status === "approved" ? "approved" : status === "rejected" ? "blocked" : "pending_approval",
    sensitivity: file.match_score > 0.85 ? "high" : "medium",
    leavesDevice: true,
    verified: file.match_score >= 0.7,
  };
}

interface ApprovalCardMessageProps {
  message: FileCandidateApprovalMessage;
}

export function ApprovalCardMessage({ message }: ApprovalCardMessageProps) {
  const navigate = useNavigate();
  const card = message.card;
  const { mutate: approve, isPending: isApproving } = useApproveFileRequest();
  const { mutate: reject, isPending: isRejecting } = useRejectFileRequest();
  const { mutate: submitFeedback, isPending: isFeedbackSubmitting } = useSubmitApprovalFeedback();
  const rebindFile = useRebindApprovalFile();

  const [selectedId, setSelectedId] = useState<string | null>(
    card.selected_candidate_id ?? card.candidates[0]?.candidate_id ?? null
  );
  const [feedback, setFeedback] = useState("");
  const [showFilePicker, setShowFilePicker] = useState(false);
  const [manualQuery, setManualQuery] = useState(card.request_text);
  const indexedFiles = useIndexedFiles(8, 0, showFilePicker ? manualQuery : "", "");

  const disabled = isApproving || isRejecting || isFeedbackSubmitting || rebindFile.isPending || card.status !== "pending";
  const selectedFile = card.candidates.find((file) => file.candidate_id === selectedId) ?? card.candidates[0];
  const previewFile = candidateToPreview(selectedFile, card.status);
  const requester = formatRequester(card.requester);
  const risk = previewFile.sensitivity ?? "medium";
  const displayFileName = decodeFileName(selectedFile?.file_name ?? previewFile.name);
  const requestLine = requester === "You" ? `You requested ${displayFileName}` : `${requester} wants to send ${displayFileName}`;

  const handleApprove = useCallback(() => {
    if (selectedId) approve({ approvalId: card.approval_id, feedback: undefined });
  }, [approve, card.approval_id, selectedId]);

  const handleReject = useCallback(() => {
    reject({ approvalId: card.approval_id });
  }, [reject, card.approval_id]);

  const handleFeedback = useCallback(() => {
    if (feedback.trim()) {
      submitFeedback({ approvalId: card.approval_id, feedback: feedback.trim() });
      setFeedback("");
    }
  }, [submitFeedback, card.approval_id, feedback]);

  const handleManualBind = useCallback((fileId: string) => {
    rebindFile.mutate({ approvalId: card.approval_id, fileId }, {
      onSuccess: () => {
        setSelectedId(fileId);
        setShowFilePicker(false);
      }
    });
  }, [rebindFile, card.approval_id]);

  const handleViewAudit = useCallback(() => {
    navigate(`/audit?q=${encodeURIComponent(displayFileName)}`);
  }, [displayFileName, navigate]);

  return (
    <section className="oa-agent-card" role="region" aria-label={`Approval request: ${card.request_text}`}>
      <div className="oa-agent-card-header">
        <div className="min-w-0">
          <div className="oa-agent-card-kicker">Approval required</div>
          <h3 className="oa-agent-card-title">Review file transfer</h3>
          <p className="oa-agent-card-subtitle">{requestLine}</p>
        </div>
        <span className={`oa-risk-pill ${risk}`}>{risk} risk</span>
      </div>

      <RiskSummary risk={risk} />

      <DocumentPreviewCard
        file={previewFile}
        primaryAction={card.status === "pending" && selectedId ? (
          <ApprovalActionBar
            disabled={disabled}
            onApprove={handleApprove}
            onReject={handleReject}
            onViewAudit={handleViewAudit}
          />
        ) : (
          <button type="button" onClick={handleViewAudit} className="oa-doc-action" aria-label="View audit for file transfer">
            <ExternalLink size={16} aria-hidden="true" />
            View audit
          </button>
        )}
      />

      {card.candidates.length > 1 && (
        <div className="oa-candidate-list" aria-label="Candidate files">
          {card.candidates.map((file) => (
            <CandidateFileRow
              key={file.candidate_id}
              file={file}
              selected={selectedId === file.candidate_id}
              onSelect={setSelectedId}
            />
          ))}
        </div>
      )}

      {card.status === "pending" && card.candidates.length === 0 && (
        <div className="oa-agent-card-panel">
          <div className="flex items-start gap-2">
            <Search className="mt-0.5 h-4 w-4 shrink-0 text-oa-amber" aria-hidden="true" />
            <div>
              <p className="text-xs font-medium text-oa-chat-text">No candidate files found</p>
              <p className="mt-0.5 text-[11px] text-oa-chat-muted">Add a filename, date range, or folder hint to refine the search.</p>
            </div>
          </div>
        </div>
      )}

      {card.status === "pending" && card.candidates.length === 0 && (
        <div className="oa-agent-card-panel">
          <button
            type="button"
            disabled={disabled}
            onClick={() => setShowFilePicker((value) => !value)}
            className="oa-doc-action"
          >
            <FolderOpen size={16} aria-hidden="true" />
            Choose indexed file
          </button>
          {showFilePicker && (
            <div className="mt-3 space-y-2">
              <input
                value={manualQuery}
                onChange={(event) => setManualQuery(event.target.value)}
                placeholder="Search indexed files..."
                className="w-full rounded-lg border border-oa-chat-border bg-oa-chat-panel-bg px-3 py-2 text-xs text-oa-chat-text outline-none transition focus:border-oa-blue"
              />
              <div className="max-h-44 space-y-1 overflow-y-auto">
                {(indexedFiles.data?.items ?? []).map((file) => (
                  <button
                    key={file.id}
                    type="button"
                    disabled={disabled}
                    onClick={() => handleManualBind(String(file.id))}
                    className="w-full rounded-lg border border-oa-chat-border bg-oa-chat-bg p-2 text-left text-xs hover:border-oa-blue/50 disabled:opacity-50"
                  >
                    <div className="truncate font-medium text-oa-chat-text">{file.fileName}</div>
                    <div className="truncate text-[10px] text-oa-chat-muted">{file.displayPath}</div>
                  </button>
                ))}
                {!indexedFiles.isLoading && (indexedFiles.data?.items ?? []).length === 0 && (
                  <div className="rounded-lg border border-dashed border-oa-chat-border p-2 text-[10px] text-oa-chat-muted">
                    No indexed files match this search.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {card.status === "pending" && (
        <div className="oa-agent-card-panel">
          <div>
            <p className="text-[11px] font-medium text-oa-chat-text">Refine file search</p>
            <p className="text-[10px] text-oa-chat-muted">Use this when the candidates are missing or incorrect.</p>
          </div>
          <textarea
            value={feedback}
            onChange={(event) => setFeedback(event.target.value)}
            placeholder="Type feedback to refine search..."
            rows={2}
            disabled={disabled}
            className="mt-2 w-full resize-none rounded-lg border border-oa-chat-border bg-oa-chat-bg p-2 text-xs text-oa-chat-text outline-none transition focus:border-oa-blue disabled:opacity-50"
          />
          <button
            type="button"
            disabled={disabled || !feedback.trim()}
            onClick={handleFeedback}
            className="oa-doc-action mt-2"
          >
            <Search size={16} aria-hidden="true" />
            Search again
          </button>
        </div>
      )}

      {card.status === "feedback" && (
        <div className="oa-agent-card-panel text-xs text-oa-amber">
          Feedback requested: &ldquo;{card.feedback_text ?? "Awaiting your correction"}&rdquo;
        </div>
      )}
    </section>
  );
}

function RiskSummary({ risk }: { risk: string }) {
  const title = `${risk} risk`;
  const description = risk === "high"
    ? "This file leaves this device and matches a sensitive category."
    : "This file leaves this device and needs explicit approval.";
  const checks = ["File hash verified", "Recipient confirmed", "User approval required", "No previous approval found"];

  return (
    <section className="oa-risk-summary" aria-label="Risk summary">
      <div className="oa-risk-summary-head">
        <Shield size={18} aria-hidden="true" />
        <div>
          <h4 className="oa-risk-summary-title">{title}</h4>
          <p className="oa-risk-summary-copy">{description}</p>
        </div>
      </div>
      <ul className="oa-risk-checklist">
        {checks.map((check) => (
          <li key={check}>
            <CheckCircle2 size={14} aria-hidden="true" />
            {check}
          </li>
        ))}
      </ul>
    </section>
  );
}

function ApprovalActionBar({
  disabled,
  onApprove,
  onReject,
  onViewAudit
}: {
  disabled: boolean;
  onApprove: () => void;
  onReject: () => void;
  onViewAudit: () => void;
}) {
  return (
    <div className="oa-approval-action-bar" aria-label="File transfer actions">
      <button
        type="button"
        disabled={disabled}
        onClick={onApprove}
        className="oa-doc-action primary"
        aria-label="Approve and send file"
      >
        <CheckCircle2 size={16} aria-hidden="true" />
        Approve and send
      </button>
      <PreviewButton />
      <BiometricApproveButton onApprove={onApprove} disabled={disabled} />
      <button type="button" onClick={onViewAudit} className="oa-doc-action" aria-label="View audit for file transfer">
        <ExternalLink size={16} aria-hidden="true" />
        View audit
      </button>
      <button type="button" disabled={disabled} onClick={onReject} className="oa-doc-action danger" aria-label="Deny file transfer">
        <X size={16} aria-hidden="true" />
        Deny
      </button>
    </div>
  );
}

function CandidateFileRow({
  file,
  selected,
  onSelect,
}: {
  file: CandidateFile;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(file.candidate_id)}
      className={`oa-candidate-row ${selected ? "selected" : ""}`}
    >
      <span className="truncate font-medium">{file.file_name}</span>
      <span className="shrink-0 text-oa-green">{Math.round(file.match_score * 100)}%</span>
    </button>
  );
}
