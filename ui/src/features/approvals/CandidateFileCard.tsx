import { FileText, Eye } from "lucide-react";
import type { CandidateFile } from "../../api/types";
import { formatSize } from "../../lib/format";

interface CandidateFileCardProps {
  file: CandidateFile;
  selected: boolean;
  onSelect: (id: string) => void;
  onPreview?: (id: string) => void;
}

export function CandidateFileCard({ file, selected, onSelect, onPreview }: CandidateFileCardProps) {
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
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 pl-5 text-[10px] text-oa-text-disabled">
        <span>{formatSize(file.size_bytes)}</span>
        <span>{new Date(file.modified_at).toLocaleDateString()}</span>
        <span className="text-oa-text-muted">{file.match_reason}</span>
        {onPreview && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onPreview(file.candidate_id); }}
            className="inline-flex items-center gap-0.5 rounded border border-oa-border bg-oa-surface-2 px-1.5 py-0.5 text-[9px] text-oa-text-muted hover:bg-oa-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue"
            aria-label="Preview file"
          >
            <Eye className="h-2.5 w-2.5" />
            Preview
          </button>
        )}
      </div>
      {file.safety_labels.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1 pl-5">
          {file.safety_labels.map((label) => (
            <span key={label} className="rounded bg-oa-amber/10 px-1.5 py-0.5 text-[9px] text-oa-amber">
              {label}
            </span>
          ))}
        </div>
      )}
    </button>
  );
}
