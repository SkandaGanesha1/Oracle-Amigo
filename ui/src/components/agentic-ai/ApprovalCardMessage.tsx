import { useCallback, useState } from "react";
import { Shield, X, Search, FileText, Clock, FolderOpen } from "lucide-react";
import { useApproveFileRequest, useIndexedFiles, useRebindApprovalFile, useRejectFileRequest, useSubmitApprovalFeedback } from "../../hooks/queries";
import { BiometricApproveButton } from "../../features/approvals/BiometricApproveButton";
import { RedactionEditor } from "../../features/approvals/RedactionEditor";
import type { FileCandidateApprovalMessage, CandidateFile } from "../../api/types";

const AGENT_ID_RE = /^ag[ei][_-]/i;

function formatRequester(id: string): string {
  if (AGENT_ID_RE.test(id.trim())) return "Remote agent";
  if (/^me$/i.test(id.trim()) || id.trim() === "You") return "You";
  return id;
}

interface ApprovalCardMessageProps {
  message: FileCandidateApprovalMessage;
}

export function ApprovalCardMessage({ message }: ApprovalCardMessageProps) {
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

  const statusColors: Record<string, string> = {
    pending: "text-oa-amber bg-oa-amber/10 border-oa-amber/20",
    approved: "text-oa-green bg-oa-green/10 border-oa-green/20",
    rejected: "text-oa-red bg-oa-red/10 border-oa-red/20",
    feedback_requested: "text-oa-blue bg-oa-blue/10 border-oa-blue/20",
    feedback_received: "text-oa-purple bg-oa-purple/10 border-oa-purple/20",
    expired: "text-oa-text-muted bg-oa-surface border-oa-border",
  };

  return (
    <div className="rounded-xl card-approval-request border p-4 shadow-sm" role="region" aria-label={`File approval request: ${card.request_text}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-oa-amber/10">
            <Shield className="card-icon h-4 w-4" />
          </div>
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-oa-text-muted">
              File Request
            </h3>
            <p className="mt-1 text-sm text-oa-text">{card.request_text}</p>
            <p className="mt-0.5 text-[11px] text-oa-text-muted">
              {formatRequester(card.requester) === "You" ? "Requested by you" : `Requested by ${formatRequester(card.requester)}`}
            </p>
          </div>
        </div>
        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${statusColors[card.status] ?? "text-oa-text-muted bg-oa-surface border-oa-border"}`}>
          {card.status.replace(/_/g, " ")}
        </span>
      </div>

      <div className="mt-4">
        <p className="mb-2 text-[11px] font-medium text-oa-text-muted">
          {card.candidates.length} candidate{card.candidates.length !== 1 ? "s" : ""}
        </p>
        {card.candidates.length === 0 ? (
          <div className="rounded-xl border border-dashed border-oa-amber/30 bg-oa-amber/5 p-3">
            <div className="flex items-start gap-2">
              <Search className="mt-0.5 h-4 w-4 shrink-0 text-oa-amber" />
              <div>
                <p className="text-xs font-medium text-oa-text">No candidate files found</p>
                <p className="mt-0.5 text-[10px] text-oa-text-muted">
                  Add a filename, date range, or folder hint below to refine the search.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-1.5">
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
      </div>

      {card.status === "pending" && selectedId && (
        <div className="mt-4 flex flex-wrap gap-2">
          <BiometricApproveButton onApprove={handleApprove} disabled={disabled} />
          <button
            type="button"
            disabled={disabled}
            onClick={handleReject}
            className="inline-flex items-center gap-1.5 rounded-lg border border-oa-border bg-oa-surface-2 px-3 py-1.5 text-xs font-medium text-oa-text transition hover:bg-oa-surface disabled:opacity-50"
          >
            <X className="h-3.5 w-3.5" />
            Reject
          </button>
        </div>
      )}

      {card.status === "pending" && card.candidates.length === 0 && (
        <div className="mt-3 rounded-xl border border-oa-border/70 bg-oa-bg-elevated/60 p-3">
          <button
            type="button"
            disabled={disabled}
            onClick={() => setShowFilePicker((value) => !value)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-oa-blue/30 bg-oa-blue/10 px-3 py-1.5 text-xs font-medium text-oa-blue transition hover:bg-oa-blue/20 disabled:opacity-50"
          >
            <FolderOpen className="h-3.5 w-3.5" />
            Choose indexed file
          </button>
          {showFilePicker && (
            <div className="mt-3 space-y-2">
              <input
                value={manualQuery}
                onChange={(event) => setManualQuery(event.target.value)}
                placeholder="Search indexed files..."
                className="w-full rounded-lg border border-oa-border bg-oa-bg px-3 py-2 text-xs text-oa-text outline-none transition focus:border-oa-blue"
              />
              <div className="max-h-44 space-y-1 overflow-y-auto">
                {(indexedFiles.data?.items ?? []).map((file) => (
                  <button
                    key={file.id}
                    type="button"
                    disabled={disabled}
                    onClick={() => handleManualBind(String(file.id))}
                    className="w-full rounded-lg border border-oa-border bg-oa-bg p-2 text-left text-xs hover:border-oa-blue/50 disabled:opacity-50"
                  >
                    <div className="truncate font-medium text-oa-text">{file.fileName}</div>
                    <div className="truncate text-[10px] text-oa-text-muted">{file.displayPath}</div>
                  </button>
                ))}
                {!indexedFiles.isLoading && (indexedFiles.data?.items ?? []).length === 0 && (
                  <div className="rounded-lg border border-dashed border-oa-border p-2 text-[10px] text-oa-text-muted">
                    No indexed files match this search.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {card.status === "pending" && selectedFile && (
        <div className="mt-4">
          <RedactionEditor file={selectedFile} recipientDisplayName={formatRequester(card.requester)} />
        </div>
      )}

      {card.status === "pending" && (
        <div className="mt-3 space-y-2 rounded-xl border border-oa-border/70 bg-oa-bg-elevated/60 p-3">
          <div>
            <p className="text-[11px] font-medium text-oa-text">Refine file search</p>
            <p className="text-[10px] text-oa-text-muted">Use this when the candidates are missing or incorrect.</p>
          </div>
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="Type feedback to refine search..."
            rows={2}
            disabled={disabled}
            className="w-full resize-none rounded-lg border border-oa-border bg-oa-bg p-2 text-xs text-oa-text placeholder-oa-text-disabled outline-none transition focus:border-oa-blue disabled:opacity-50"
          />
          <button
            type="button"
            disabled={disabled || !feedback.trim()}
            onClick={handleFeedback}
            className="inline-flex items-center gap-1.5 rounded-lg border border-oa-blue/30 bg-oa-blue/10 px-3 py-1.5 text-xs font-medium text-oa-blue transition hover:bg-oa-blue/20 disabled:opacity-50"
          >
            <Search className="h-3.5 w-3.5" />
            Search Again with Feedback
          </button>
        </div>
      )}

      {card.status === "feedback" && (
        <div className="mt-3 rounded-lg border border-oa-amber/20 bg-oa-amber/5 p-3 text-xs text-oa-amber">
          Feedback requested: &ldquo;{card.feedback_text ?? "Awaiting your correction"}&rdquo;
        </div>
      )}

      {card.expires_at && (
        <div className="mt-3 flex items-center gap-1.5 text-[10px] text-oa-text-disabled">
          <Clock className="h-3 w-3" />
          Expires {new Date(card.expires_at).toLocaleString()}
        </div>
      )}
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
      className={`w-full rounded-lg border p-2.5 text-left text-xs transition ${
        selected
          ? "border-oa-green/40 bg-oa-green/5"
          : "border-oa-border bg-oa-bg-elevated hover:border-oa-border-strong"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <FileText className="h-3 w-3 shrink-0 text-oa-text-muted" />
            <span className="truncate font-medium text-oa-text">{file.file_name}</span>
          </div>
          <div className="mt-0.5 truncate pl-5 text-[10px] text-oa-text-muted">
            {file.display_path}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="font-semibold text-oa-green">{Math.round(file.match_score * 100)}%</div>
          <div className="text-[10px] text-oa-text-muted">{file.extension || "unknown"}</div>
        </div>
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 pl-5 text-[10px] text-oa-text-disabled">
        <span>{formatSize(file.size_bytes)}</span>
        <span>{new Date(file.modified_at).toLocaleDateString()}</span>
        <span className="text-oa-text-muted">{file.match_reason}</span>
      </div>
    </button>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
