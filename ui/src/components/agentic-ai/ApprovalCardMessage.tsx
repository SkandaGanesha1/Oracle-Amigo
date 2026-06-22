import { useCallback, useMemo, useRef, useState } from "react";
import { CheckCircle2, CheckIcon, FileText, MessageSquareText, Search, XCircle, XIcon } from "lucide-react";
import { BorderRotate } from "@/components/ui/animated-gradient-border";
import SocialPostCard, { type SocialPostCardAction } from "@/components/ui/social-post-card";
import {
  Confirmation,
  ConfirmationAccepted,
  ConfirmationRejected,
  ConfirmationRequest,
  ConfirmationTitle,
} from "@/components/ai-elements/confirmation";
import { useApproveFileRequest, useRejectFileRequest, useSubmitApprovalFeedback } from "../../hooks/queries";
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

function fileTypeLabel(file: CandidateFile | undefined): string {
  if (!file?.extension) return "File";
  return file.extension.replace(/^\./, "").toUpperCase();
}

function agentNameForRequester(requester: string): string {
  if (requester === "You") return "My local agent";
  if (requester === "Remote agent") return "Remote Agent";
  const clean = requester.trim().replace(/'s agent$/i, "").replace(/\s+agent$/i, "");
  return clean ? `${clean}'s Agent` : "Remote Agent";
}

function usernameForAgent(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "agent";
}

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return (parts[0] ?? "A").slice(0, 2).toUpperCase();
}

interface ApprovalCardMessageProps {
  message: FileCandidateApprovalMessage;
}

export function ApprovalCardMessage({ message }: ApprovalCardMessageProps) {
  const card = message.card;
  const { mutate: approve, isPending: isApproving } = useApproveFileRequest();
  const { mutate: reject, isPending: isRejecting } = useRejectFileRequest();
  const { mutate: submitFeedback, isPending: isFeedbackSubmitting } = useSubmitApprovalFeedback();
  const feedbackRef = useRef<HTMLTextAreaElement | null>(null);

  const [selectedId] = useState<string | null>(
    card.selected_candidate_id ?? card.candidates[0]?.candidate_id ?? null
  );
  const [feedback, setFeedback] = useState("");
  const [showFeedback, setShowFeedback] = useState(false);

  const disabled = isApproving || isRejecting || isFeedbackSubmitting || card.status !== "pending";
  const selectedFile = card.candidates.find((file) => file.candidate_id === selectedId) ?? card.candidates[0];
  const requester = formatRequester(card.requester);
  const displayFileName = decodeFileName(selectedFile?.file_name ?? "No matching file selected");
  const requestLine = requester === "You" ? `You requested ${displayFileName}` : `${requester} wants to send ${displayFileName}`;
  const authorName = agentNameForRequester(requester);
  const isApproved = card.status === "approved";
  const isRejected = card.status === "rejected";
  const documentDescription = [
    selectedFile?.size_bytes != null ? formatSize(selectedFile.size_bytes) : null,
    fileTypeLabel(selectedFile),
    selectedFile?.match_reason || "Exact filename match",
  ].filter(Boolean).join(" · ");

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

  const handleToggleFeedback = useCallback(() => {
    setShowFeedback((value) => {
      const next = !value;
      if (!value) window.setTimeout(() => feedbackRef.current?.focus(), 0);
      return next;
    });
  }, []);

  const actions = useMemo<[SocialPostCardAction, SocialPostCardAction, SocialPostCardAction]>(() => [
    {
      key: "send",
      label: "Send",
      icon: <CheckCircle2 className="h-5 w-5" aria-hidden="true" />,
      onClick: handleApprove,
      disabled: disabled || !selectedId,
      tone: "primary",
    },
    {
      key: "deny",
      label: "Deny",
      icon: <XCircle className="h-5 w-5" aria-hidden="true" />,
      onClick: handleReject,
      disabled,
      tone: "danger",
    },
    {
      key: "feedback",
      label: "Feedback",
      icon: <MessageSquareText className="h-5 w-5" aria-hidden="true" />,
      onClick: handleToggleFeedback,
      disabled: card.status !== "pending",
      tone: "neutral",
    },
  ], [card.status, disabled, handleApprove, handleReject, handleToggleFeedback, selectedId]);

  if (isApproved || isRejected) {
    return (
      <Confirmation
        approval={{ approved: isApproved, id: card.approval_id }}
        className="oa-approval-confirmation-state"
        state={isApproved ? "approval-responded" : "output-denied"}
      >
        <ConfirmationTitle>
          <ConfirmationRequest>
            Review file transfer. {requestLine}
          </ConfirmationRequest>
          <ConfirmationAccepted>
            <CheckIcon className="size-4 text-green-600 dark:text-green-400" aria-hidden="true" />
            <span>You approved this file transfer</span>
          </ConfirmationAccepted>
          <ConfirmationRejected>
            <XIcon className="size-4 text-destructive" aria-hidden="true" />
            <span>You rejected this file transfer</span>
          </ConfirmationRejected>
        </ConfirmationTitle>
      </Confirmation>
    );
  }

  return (
    <section className="oa-agent-card" role="region" aria-label={`Approval request: ${card.request_text}`}>
      <BorderRotate className="oa-approval-gradient-border">
        <SocialPostCard
          author={{
            name: authorName,
            username: usernameForAgent(authorName),
            avatarSeed: card.requester || authorName,
            initials: initialsFor(authorName),
            timeAgo: "now",
          }}
          contentText={`Review file transfer. ${requestLine}`}
          document={{
            title: displayFileName,
            description: documentDescription,
            icon: <FileText className="h-6 w-6 text-blue-400" aria-hidden="true" />,
          }}
          actions={actions}
          bookmarkedLabel={`Approval request: ${card.request_text}`}
          className="oa-social-approval-card"
        />
      </BorderRotate>

      {card.status === "pending" && showFeedback && (
        <div className="oa-agent-card-panel">
          <div>
            <p className="text-[11px] font-medium text-oa-chat-text">Refine file search</p>
            <p className="text-[10px] text-oa-chat-muted">Use this when the candidates are missing or incorrect.</p>
          </div>
          <textarea
            ref={feedbackRef}
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
