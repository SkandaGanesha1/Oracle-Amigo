import { useEffect, useState, type FC } from "react";

type StoredFile = {
  id: string;
  storedPath: string;
  originalFileName: string;
  sha256: string;
  sizeBytes: number;
  receivedAt: string;
};

export const ReceivedFilesPanel: FC = () => {
  const [files, setFiles] = useState<StoredFile[]>([]);

  useEffect(() => {
    const fetchFiles = async () => {
      try {
        const res = await fetch("/storage/files");
        if (res.ok) {
          const body = (await res.json()) as { files: StoredFile[] };
          setFiles(body.files);
        }
      } catch { /* ignore */ }
    };
    fetchFiles();
    const interval = setInterval(fetchFiles, 5000);
    return () => clearInterval(interval);
  }, []);

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
                href={`/storage/files/${f.id}/download`}
                className="shrink-0 rounded bg-white/10 px-2 py-0.5 text-[10px] text-white/50 transition hover:bg-white/15"
                download
              >
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
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
