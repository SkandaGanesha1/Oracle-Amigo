import type { FC } from "react";

export type CandidateFile = {
  id: number;
  fileName: string;
  displayPath: string;
  extension: string;
  sizeBytes: number;
  modifiedAt: string;
  score: number;
  reason: string;
};

export const CandidateFileCard: FC<{
  file: CandidateFile;
  selected: boolean;
  onSelect: (fileId: number) => void;
}> = ({ file, selected, onSelect }) => (
  <div
    className={`cursor-pointer rounded border p-2 text-xs transition ${
      selected
        ? "border-emerald-400/50 bg-emerald-500/10"
        : "border-white/10 bg-black/25 hover:border-white/20"
    }`}
    onClick={() => onSelect(file.id)}
  >
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-white">{file.fileName}</div>
        <div className="mt-0.5 truncate text-white/45">{file.displayPath}</div>
      </div>
      <div className="shrink-0 text-right">
        <div className="text-emerald-300">{Math.round(file.score * 100)}%</div>
        <div className="text-[10px] text-white/40">{file.extension || "unknown"}</div>
      </div>
    </div>
    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-white/40">
      <span>{formatSize(file.sizeBytes)}</span>
      <span>{new Date(file.modifiedAt).toLocaleDateString()}</span>
      <span className="text-white/30">{file.reason}</span>
    </div>
  </div>
);

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
