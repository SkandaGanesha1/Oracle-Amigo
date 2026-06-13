import { useEffect, useState, type FC } from "react";

type TransferStatusData = {
  id: string;
  task_id: string;
  from_agent_id: string;
  to_agent_id: string;
  file_name: string;
  size_bytes: number;
  sha256: string;
  status: string;
  created_at: string;
  completed_at: string | null;
};

export const TransferStatus: FC<{ taskId?: string }> = ({ taskId }) => {
  const [transfers, setTransfers] = useState<TransferStatusData[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let controller: AbortController | null = null;
    const fetchTransfers = async () => {
      controller?.abort();
      controller = new AbortController();
      try {
        const res = await fetch("/transfers", { signal: controller.signal });
        if (!active) return;
        if (!res.ok) {
          setError(`Transfers failed: HTTP ${res.status}`);
          return;
        }
        const body = (await res.json()) as { transfers: TransferStatusData[] };
        if (!active) return;
        setTransfers(
          taskId
            ? body.transfers.filter((t) => t.task_id === taskId)
            : body.transfers
        );
        setError(null);
      } catch (err) {
        if (!active || (err instanceof DOMException && err.name === "AbortError")) return;
        setError(err instanceof Error ? err.message : "Transfers failed");
      }
    };
    fetchTransfers();
    const interval = setInterval(fetchTransfers, 3000);
    return () => {
      active = false;
      controller?.abort();
      clearInterval(interval);
    };
  }, [taskId]);

  if (transfers.length === 0 && !error) return null;

  return (
    <div className="rounded border border-white/10 bg-black/20 p-3 text-xs text-white/70">
      <h3 className="mb-1 text-[11px] font-medium text-white/40">TRANSFERS</h3>
      {error && <div className="mb-2 rounded bg-red-500/10 px-2 py-1 text-[10px] text-red-300">{error}</div>}
      <div className="space-y-1.5">
        {transfers.map((t) => (
          <div key={t.id} className="flex items-center justify-between gap-2">
            <div className="min-w-0 flex-1 truncate">{t.file_name}</div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="text-white/30">{formatSize(t.size_bytes)}</span>
              <span
                className={`rounded px-1.5 py-0.5 text-[10px] ${
                  t.status === "completed" || t.status === "stored" || t.status === "available"
                    ? "bg-emerald-500/20 text-emerald-300"
                    : "bg-amber-500/20 text-amber-300"
                }`}
              >
                {t.status}
              </span>
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
