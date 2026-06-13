import { useReceivedFiles } from "../../ui/src/hooks/queries";
import { Download, HardDrive } from "lucide-react";

export function ReceivedFilesPanel() {
  const { data, isLoading } = useReceivedFiles();
  const files = data?.files ?? [];

  if (isLoading) {
    return (
      <div className="rounded border border-white/10 bg-black/20 p-3 text-xs text-white/40">
        Loading stored files...
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <div className="rounded border border-white/10 bg-black/20 p-3 text-xs text-white/40">
        No stored files yet.
      </div>
    );
  }

  return (
    <div className="rounded border border-white/10 bg-black/20 p-3 text-xs text-white/70">
      <h3 className="mb-2 text-[11px] font-medium text-white/40">RECEIVED FILES</h3>
      <div className="space-y-1.5">
        {files.map((f) => (
          <div key={f.id} className="rounded border border-white/5 bg-black/30 p-2">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate font-medium text-white/80">{f.originalFileName}</span>
              <a
                href={`/storage/files/${encodeURIComponent(f.id)}/download`}
                className="shrink-0 rounded bg-white/10 px-2 py-0.5 text-[10px] text-white/50 transition hover:bg-white/15"
                download
              >
                <Download className="mr-1 inline h-3 w-3" />
                Download
              </a>
            </div>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-white/35">
              <span>{formatSize(f.sizeBytes)}</span>
              <span>{new Date(f.receivedAt).toLocaleDateString()}</span>
              <span className="font-mono">{f.sha256.slice(0, 12)}...</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
