import type { CandidateFile } from "../../api/types";
import { CandidateFileCard } from "./CandidateFileCard";

interface CandidateFileListProps {
  candidates: CandidateFile[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onPreview?: (id: string) => void;
}

export function CandidateFileList({ candidates, selectedId, onSelect, onPreview }: CandidateFileListProps) {
  if (candidates.length === 0) {
    return (
      <p className="text-[11px] text-oa-text-disabled italic">
        No candidate files found for this request.
      </p>
    );
  }

  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-medium text-oa-text-muted">
        {candidates.length} candidate{candidates.length !== 1 ? "s" : ""}
      </p>
      <div className="space-y-1.5">
        {candidates.map((file) => (
          <CandidateFileCard
            key={file.candidate_id}
            file={file}
            selected={selectedId === file.candidate_id}
            onSelect={onSelect}
            onPreview={onPreview}
          />
        ))}
      </div>
    </div>
  );
}
