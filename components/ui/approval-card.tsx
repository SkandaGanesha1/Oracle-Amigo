import { useState, type FC } from "react";
import type { CandidateFile } from "./candidate-file-card";
import { CandidateFileCard } from "./candidate-file-card";
import { FeedbackBox } from "./feedback-box";

export type PersonalApproval = {
  approvalId: string;
  taskId: string;
  requesterName: string;
  requestText: string;
  candidates: CandidateFile[];
  status: string;
};

export const ApprovalCard: FC<{
  approval: PersonalApproval;
  onApprove: (approvalId: string, fileId: number) => void;
  onReject: (approvalId: string) => void;
  onFeedback: (approvalId: string, feedback: string) => void;
  onSearchAgain?: (approvalId: string) => void;
  onChooseManually?: (approvalId: string) => void;
  disabled?: boolean;
}> = ({ approval, onApprove, onReject, onFeedback, onSearchAgain, onChooseManually, disabled }) => {
  const [selectedFileId, setSelectedFileId] = useState<number | null>(
    approval.candidates[0]?.id ?? null
  );

  return (
    <div className="rounded border border-white/10 bg-[#111214]/90 p-3 text-sm text-white shadow-lg backdrop-blur">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-white/50">
            File Request
          </h3>
          <p className="mt-1 text-sm text-white/80">{approval.requestText}</p>
        </div>
        <span className="shrink-0 rounded bg-amber-500/20 px-2 py-0.5 text-[10px] text-amber-300">
          {approval.status}
        </span>
      </div>

      <div className="mt-3">
        <p className="mb-1.5 text-[11px] text-white/40">
          {approval.candidates.length} candidate{approval.candidates.length !== 1 ? "s" : ""} found
        </p>
        <div className="space-y-1.5">
          {approval.candidates.map((f) => (
            <CandidateFileCard
              key={f.id}
              file={f}
              selected={selectedFileId === f.id}
              onSelect={setSelectedFileId}
            />
          ))}
        </div>
      </div>

      {selectedFileId && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={disabled}
            onClick={() => onApprove(approval.approvalId, selectedFileId)}
            className="rounded bg-emerald-500 px-3 py-1.5 text-xs font-medium text-black transition hover:bg-emerald-400 disabled:opacity-50"
          >
            Select & Approve
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onReject(approval.approvalId)}
            className="rounded border border-white/10 bg-white/10 px-3 py-1.5 text-xs text-white transition hover:bg-white/15 disabled:opacity-50"
          >
            Reject
          </button>
          {onSearchAgain && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => onSearchAgain(approval.approvalId)}
              className="rounded border border-sky-500/30 bg-sky-500/10 px-3 py-1.5 text-xs text-sky-200 transition hover:bg-sky-500/20 disabled:opacity-50"
              title="Re-run the search with the original query (different ranking)"
            >
              Search Again
            </button>
          )}
          {onChooseManually && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => onChooseManually(approval.approvalId)}
              className="rounded border border-violet-500/30 bg-violet-500/10 px-3 py-1.5 text-xs text-violet-200 transition hover:bg-violet-500/20 disabled:opacity-50"
              title="Browse the full index and pick a file yourself"
            >
              Choose Manually
            </button>
          )}
        </div>
      )}

      <FeedbackBox
        disabled={disabled}
        onFeedback={(fb) => onFeedback(approval.approvalId, fb)}
      />
    </div>
  );
};
