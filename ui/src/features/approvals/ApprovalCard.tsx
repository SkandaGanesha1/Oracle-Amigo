import { useCallback, useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Shield, ShieldCheck, ShieldAlert, Check, X, Clock, ArrowRight, Search, FileWarning, FileText, Eye, Ban, HelpCircle, User, BadgeCheck, BadgeAlert, Send, AlertTriangle } from "lucide-react";
import { useApproveFileRequest, useRejectFileRequest, useSubmitApprovalFeedback, useConsentAction, useIndexedFiles, useRebindApprovalFile } from "../../hooks/queries";
import type { FileCandidateApprovalCard } from "../../api/types";
import { CandidateFileList } from "./CandidateFileList";
import { ApprovalRiskHeader } from "./ApprovalRiskHeader";
import { ApprovalExactBinding } from "./ApprovalExactBinding";
import { ApprovalFeedbackBox } from "./ApprovalFeedbackBox";
import { ApprovalTerminalState } from "./ApprovalTerminalState";
import { ApprovalPolicyBadge } from "./ApprovalPolicyBadge";
import { OracleButton } from "../../components/primitives/OracleButton";
import { FilePreview } from "./FilePreview";
import { PrivacyBadge } from "../../components/primitives/PrivacyBadge";
import { RiskHeatmap } from "./RiskHeatmap";
import { detectFileSensitivity, SENSITIVITY_CONFIG } from "../../types";

const AGENT_ID_RE = /^ag[ei][_-]/i;

function formatRequester(id: string): string {
  if (AGENT_ID_RE.test(id.trim())) return "Remote agent";
  if (/^me$/i.test(id.trim()) || id.trim() === "You") return "You";
  return id;
}

function initialFilePickerQuery(requestText: string): string {
  return requestText
    .replace(/^(\s*(please|can|could|would|send|share|get|find|locate|show|give)\s+)+/i, "")
    .replace(/^\s*(me|the|a|an)\s+/i, "")
    .replace(/\s+(file|document)\s*$/i, "")
    .trim();
}

interface ApprovalCardProps {
  card: FileCandidateApprovalCard;
}

export function ApprovalCard({ card }: ApprovalCardProps) {
  const statusLabel = card.status === "pending" ? "Pending approval" : card.status === "approved" ? "Approved" : card.status === "rejected" ? "Rejected" : card.status === "expired" ? "Expired" : card.status;
  const { mutate: approve, isPending: isApproving } = useApproveFileRequest();
  const { mutate: reject, isPending: isRejecting } = useRejectFileRequest();
  const { mutate: submitFeedback, isPending: isFeedbackSubmitting } = useSubmitApprovalFeedback();
  const rebindFile = useRebindApprovalFile();
  const consentAction = useConsentAction();

  const [selectedId, setSelectedId] = useState<string | null>(
    card.selected_candidate_id ?? card.candidates[0]?.candidate_id ?? null
  );
  const [selectedAccessType, setSelectedAccessType] = useState<"one-time" | "time-bound" | "permanent">("one-time");
  const [expiryHours, setExpiryHours] = useState(24);
  const [expiryText, setExpiryText] = useState("");
  const [showAskWhy, setShowAskWhy] = useState(false);
  const [askWhyText, setAskWhyText] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const [showFilePicker, setShowFilePicker] = useState(false);
  const [manualQuery, setManualQuery] = useState(() => initialFilePickerQuery(card.request_text));
  const indexedFiles = useIndexedFiles(8, 0, showFilePicker ? manualQuery : "", "");

  useEffect(() => {
    if (!card.expires_at) return;
    const tick = () => {
      const remaining = new Date(card.expires_at).getTime() - Date.now();
      if (remaining <= 0) { setExpiryText("Expired"); return; }
      const mins = Math.floor(remaining / 60000);
      const hrs = Math.floor(mins / 60);
      setExpiryText(hrs > 0 ? `${hrs}h ${mins % 60}m` : `${mins}m`);
    };
    tick();
    const id = setInterval(tick, 10000);
    return () => clearInterval(id);
  }, [card.expires_at]);

  const isTerminal = card.status !== "pending" && card.status !== "feedback_requested";
  const isProcessing = isApproving || isRejecting || isFeedbackSubmitting || consentAction.isPending || rebindFile.isPending;
  const requesterLabel = formatRequester(card.requester);
  const hasCandidates = card.candidates.length > 0;
  const selectedFile = card.candidates.find((c) => c.candidate_id === selectedId);
  const sensitivity = selectedFile ? detectFileSensitivity(selectedFile.file_name, selectedFile.display_path) : detectFileSensitivity("", "");
  const senConfig = SENSITIVITY_CONFIG[sensitivity.level];

  const handleApprove = useCallback(() => {
    if (selectedId) approve({ approvalId: card.approval_id, feedback: undefined });
  }, [approve, card.approval_id, selectedId]);

  const handleReject = useCallback(() => {
    reject({ approvalId: card.approval_id });
  }, [reject, card.approval_id]);

  const handleFeedback = useCallback((feedback: string) => {
    submitFeedback({ approvalId: card.approval_id, feedback });
  }, [submitFeedback, card.approval_id]);

  const handleManualBind = useCallback((fileId: number | string) => {
    rebindFile.mutate(
      { approvalId: card.approval_id, fileId: String(fileId) },
      {
        onSuccess: (updated) => {
          const nextSelected = updated?.selected_candidate_id ?? updated?.candidates?.[0]?.candidate_id ?? null;
          setSelectedId(nextSelected);
          setShowFilePicker(false);
        }
      }
    );
  }, [rebindFile, card.approval_id]);

  const handleAskWhy = useCallback(() => {
    if (askWhyText.trim()) {
      submitFeedback({ approvalId: card.approval_id, feedback: `[Ask why] ${askWhyText.trim()}` });
      setAskWhyText("");
      setShowAskWhy(false);
    }
  }, [submitFeedback, card.approval_id, askWhyText]);

  const handleRevoke = useCallback(() => {
    consentAction.mutate({ consentId: card.approval_id, action: "revoke" });
  }, [consentAction, card.approval_id]);

  const statusColors: Record<string, string> = {
    pending: "text-oa-amber bg-oa-amber/10 border-oa-amber/20",
    approved: "text-oa-green bg-oa-green/10 border-oa-green/20",
    rejected: "text-oa-red bg-oa-red/10 border-oa-red/20",
    feedback_requested: "text-oa-blue bg-oa-blue/10 border-oa-blue/20",
    feedback_received: "text-oa-purple bg-oa-purple/10 border-oa-purple/20",
    expired: "text-oa-text-muted bg-oa-surface border-oa-border",
    decision_pending: "text-oa-amber bg-oa-amber/10 border-oa-amber/20",
    feedback: "text-oa-amber bg-oa-amber/10 border-oa-amber/20",
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className="rounded-xl card-approval-request border p-4 shadow-sm"
      role="region"
      aria-label={`Approval: ${card.request_text} - ${statusLabel}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-oa-amber/10">
            <Shield className="card-icon h-4 w-4" />
          </div>
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-oa-text-muted">
              File Request
            </h3>
            <p className="mt-1 text-sm text-oa-text break-words">{card.request_text}</p>
            <div className="mt-0.5 flex items-center gap-2">
              <p className="truncate text-[11px] text-oa-text-muted">
                Requested by {requesterLabel}
              </p>
              {AGENT_ID_RE.test(card.requester.trim()) ? (
                <span className="inline-flex items-center gap-0.5 rounded bg-oa-amber/10 px-1.5 py-0.5 text-[9px] text-oa-amber">
                  <BadgeAlert className="h-2.5 w-2.5" />
                  Unverified
                </span>
              ) : (
                <span className="inline-flex items-center gap-0.5 rounded bg-oa-green/10 px-1.5 py-0.5 text-[9px] text-oa-green">
                  <BadgeCheck className="h-2.5 w-2.5" />
                  Verified
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {card.expires_at && card.status === "pending" && expiryText && (
            <span className="flex items-center gap-1 rounded-md bg-oa-surface-2 px-1.5 py-0.5 text-[10px] text-oa-text-muted">
              <Clock className="h-3 w-3" />
              {expiryText}
            </span>
          )}
          <ApprovalPolicyBadge safetyLabels={selectedFile?.safety_labels} />
          {card.status === "pending" && (
            <PrivacyBadge boundary="leaving-device" />
          )}
          <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${statusColors[card.status] ?? "text-oa-text-muted bg-oa-surface border-oa-border"}`} aria-live="polite" aria-atomic="true">
            {card.status.replace(/_/g, " ")}
          </span>
        </div>
      </div>

      {selectedFile && (
        <div className="mt-2 flex items-center gap-2">
          <AlertTriangle className={`h-3 w-3 ${senConfig?.color ?? "text-oa-text-muted"}`} />
          <span className={`text-[10px] font-medium ${senConfig?.color ?? "text-oa-text-muted"}`}>
            {senConfig?.label ?? "Unknown"} sensitivity
          </span>
          {sensitivity.level === "critical" && (
            <span className="inline-flex items-center gap-0.5 rounded bg-oa-red/10 px-1.5 py-0.5 text-[9px] text-oa-red">
              <AlertTriangle className="h-2.5 w-2.5" />
              Critical
            </span>
          )}
        </div>
      )}

      {hasCandidates && (
        <div className="mt-4">
          <CandidateFileList
            candidates={card.candidates}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onPreview={() => setShowPreview(true)}
          />
        </div>
      )}

      {!hasCandidates && card.status === "pending" && (
        <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-oa-amber/20 bg-oa-amber/5 p-3">
          <FileWarning className="mt-0.5 h-4 w-4 shrink-0 text-oa-amber" />
          <div className="space-y-2">
            <p className="text-xs font-medium text-oa-amber">No matching files found</p>
            <p className="text-[10px] text-oa-text-muted leading-relaxed">
              The agent searched your available files but found no candidates matching &ldquo;{card.request_text}.&rdquo; Provide feedback below to refine the search, or reject this request.
            </p>
            <button
              type="button"
              onClick={() => setShowFilePicker((value) => !value)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-oa-amber/30 bg-oa-amber/10 px-2.5 py-1.5 text-xs font-medium text-oa-amber transition hover:bg-oa-amber/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-amber"
            >
              <FileText className="h-3.5 w-3.5" />
              Choose indexed file
            </button>
          </div>
        </div>
      )}

      {card.status === "pending" && showFilePicker && (
        <div className="mt-3 rounded-lg border border-oa-border bg-oa-bg-elevated p-3">
          <div className="flex items-center gap-2">
            <Search className="h-4 w-4 text-oa-text-muted" />
            <input
              type="text"
              value={manualQuery}
              onChange={(event) => setManualQuery(event.target.value)}
              placeholder="Search indexed files by name..."
              className="min-w-0 flex-1 rounded-lg border border-oa-border bg-oa-bg px-3 py-2 text-xs text-oa-text outline-none focus:border-oa-blue"
            />
          </div>
          <div className="mt-3 space-y-2">
            {(indexedFiles.data?.items ?? []).map((file) => (
              <button
                key={file.id}
                type="button"
                disabled={isProcessing}
                onClick={() => handleManualBind(file.id)}
                className="flex w-full items-center justify-between gap-3 rounded-lg border border-oa-border bg-oa-surface-2 px-3 py-2 text-left transition hover:border-oa-blue/40 disabled:opacity-60"
              >
                <span className="min-w-0">
                  <span className="block truncate text-xs font-medium text-oa-text">{file.fileName}</span>
                  <span className="block truncate text-[10px] text-oa-text-muted">{file.displayPath}</span>
                </span>
                <span className="shrink-0 text-[10px] text-oa-text-muted">{file.extension || "file"}</span>
              </button>
            ))}
            {!indexedFiles.isLoading && (indexedFiles.data?.items ?? []).length === 0 && (
              <div className="rounded-lg border border-dashed border-oa-border px-3 py-4 text-center text-xs text-oa-text-muted">
                No indexed files matched this search. Try a shorter filename or add feedback below.
              </div>
            )}
          </div>
        </div>
      )}

      {card.status === "pending" && selectedFile && (
        <div className="mt-3 space-y-3">
          <ApprovalExactBinding
            fileName={selectedFile.file_name}
            filePath={selectedFile.display_path}
          />
          <ApprovalRiskHeader
            requester={requesterLabel}
            requestText={card.request_text}
            fileName={selectedFile.file_name}
          />
          <RiskHeatmap
            matchScore={selectedFile.match_score}
            sensitivity={sensitivity.level}
            fileSize={selectedFile.size_bytes}
            requesterVerified={!AGENT_ID_RE.test(card.requester.trim())}
          />
          <div className="flex items-center gap-2 rounded-md bg-oa-surface-2 px-3 py-2">
            <ArrowRight className="h-3 w-3 text-oa-text-muted" />
            <span className="text-[10px] text-oa-text-muted">
              Data will move from <span className="text-oa-text">Local device</span> {"\u2192"} <span className="text-oa-text">{requesterLabel}</span>
            </span>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setShowPreview(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-oa-border bg-oa-surface-2 px-3 py-1.5 text-xs font-medium text-oa-text-muted transition hover:bg-oa-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue"
            >
              <Eye className="h-3.5 w-3.5" />
              Preview file
            </button>
          </div>
        </div>
      )}

      {card.status === "pending" && (
        <div className="mt-4 space-y-2">
          {hasCandidates && selectedId && (
            <div className="space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-oa-text-disabled">Access Type</p>
              {(["one-time", "time-bound", "permanent"] as const).map((type) => (
                <label
                  key={type}
                  className={`flex min-h-[48px] cursor-pointer items-center gap-3 rounded-lg border p-3 transition ${
                    selectedAccessType === type
                      ? "border-oa-blue/40 bg-oa-blue/5"
                      : "border-oa-border hover:border-oa-border-strong"
                  }`}
                >
                  <input
                    type="radio"
                    name={`access-${card.approval_id}`}
                    checked={selectedAccessType === type}
                    onChange={() => setSelectedAccessType(type)}
                    className="h-3 w-3 accent-oa-blue"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-oa-text">
                      {type === "one-time" ? "One-time access" : type === "time-bound" ? "Time-bound access" : "Permanent access"}
                    </p>
                    <p className="text-[10px] text-oa-text-muted">
                      {type === "one-time" ? "Single file access, expires after transfer" :
                       type === "time-bound" ? "Access expires after a set time" :
                       "Ongoing access until revoked"}
                    </p>
                  </div>
                </label>
              ))}
              {selectedAccessType === "time-bound" && (
                <div className="flex items-center gap-2 px-1">
                  <span className="text-[10px] text-oa-text-muted">Expires in</span>
                  {[1, 6, 12, 24, 48, 72].map((h) => (
                    <button
                      key={h}
                      type="button"
                      onClick={() => setExpiryHours(h)}
                      className={`rounded px-2 py-1 text-[10px] font-medium transition ${
                        expiryHours === h ? "bg-oa-blue/20 text-oa-blue" : "text-oa-text-muted hover:bg-oa-surface-2"
                      }`}
                    >
                      {h}h
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {hasCandidates && selectedId && (
              <OracleButton
                oaVariant="approve"
                className="h-8 text-xs px-3"
                isPending={isApproving}
                isDisabled={isProcessing}
                onPress={handleApprove}
              >
                <Check className="h-3.5 w-3.5" />
                Approve
              </OracleButton>
            )}
            <OracleButton
              oaVariant="reject"
              className="h-8 text-xs px-3"
              isPending={isRejecting}
              isDisabled={isProcessing}
              onPress={handleReject}
            >
              <X className="h-3.5 w-3.5" />
              Reject
            </OracleButton>
            <button
              type="button"
              onClick={() => setShowAskWhy(!showAskWhy)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-oa-border bg-oa-surface-2 px-3 py-1.5 text-xs font-medium text-oa-text-muted transition hover:bg-oa-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue"
            >
              <HelpCircle className="h-3.5 w-3.5" />
              Ask why
            </button>
          </div>

          {showAskWhy && (
            <div className="rounded-lg border border-oa-border bg-oa-bg-elevated p-3">
              <p className="mb-2 text-[10px] text-oa-text-muted">
                Ask the requester why they need this file. Your question will be sent as feedback.
              </p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={askWhyText}
                  onChange={(e) => setAskWhyText(e.target.value)}
                  placeholder="e.g. Why do you need my tax documents?"
                  className="flex-1 rounded border border-oa-border bg-oa-bg px-2 py-1.5 text-xs text-oa-text outline-none focus:border-oa-blue"
                  autoFocus
                />
                <button
                  type="button"
                  disabled={!askWhyText.trim() || isProcessing}
                  onClick={handleAskWhy}
                  className="inline-flex items-center gap-1 rounded bg-oa-blue px-2.5 py-1.5 text-xs font-medium text-white transition hover:bg-oa-blue/80 disabled:opacity-50"
                >
                  <Send className="h-3 w-3" />
                  Send
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {(card.status === "pending" || card.status === "feedback_requested") && (
        <div className="mt-4">
          <ApprovalFeedbackBox
            onSubmit={handleFeedback}
            disabled={isProcessing}
            placeholder={!hasCandidates ? "Describe what file you were looking for..." : "Provide feedback to refine the search..."}
          />
        </div>
      )}

      {card.feedback_text && card.status === "feedback" && (
        <div className="mt-3 rounded-lg border border-oa-amber/20 bg-oa-amber/5 p-3 text-xs text-oa-amber">
          Feedback requested: &ldquo;{card.feedback_text}&rdquo;
        </div>
      )}

      {isTerminal && (
        <div className="mt-4">
          <ApprovalTerminalState
            status={card.status as any}
            feedbackText={card.feedback_text}
            expiresAt={card.expires_at}
          />
          {card.status === "approved" && (
            <button
              type="button"
              onClick={handleRevoke}
              disabled={consentAction.isPending}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-oa-red/30 bg-oa-red/5 px-3 py-2 text-xs font-medium text-oa-red transition hover:bg-oa-red/10 disabled:opacity-50"
            >
              <Ban className="h-3.5 w-3.5" />
              Revoke access
            </button>
          )}
        </div>
      )}

      {card.expires_at && card.status === "pending" && (
        <div className="mt-3 flex items-center gap-1.5 text-[10px] text-oa-text-disabled">
          <Clock className="h-3 w-3" />
          Expires {new Date(card.expires_at).toLocaleString()}
        </div>
      )}

      <AnimatePresence>
        {showPreview && selectedFile && (
          <FilePreview
            fileName={selectedFile.file_name}
            filePath={selectedFile.display_path}
            fileSize={selectedFile.size_bytes}
            onClose={() => setShowPreview(false)}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}
