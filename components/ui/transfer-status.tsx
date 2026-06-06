import { useEffect, useState, type FC } from "react";

type Transfer = {
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
  const [transfers, setTransfers] = useState<Transfer[]>([]);

  useEffect(() => {
    const fetchTransfers = async () => {
      try {
        const res = await fetch("/transfers");
        if (res.ok) {
          const body = (await res.json()) as { transfers: Transfer[] };
          setTransfers(
            taskId
              ? body.transfers.filter((t) => t.task_id === taskId)
              : body.transfers
          );
        }
      } catch { /* ignore */ }
    };
    fetchTransfers();
    const interval = setInterval(fetchTransfers, 3000);
    return () => clearInterval(interval);
  }, [taskId]);

  if (transfers.length === 0) return null;

  return (
    <div className="rounded border border-white/10 bg-black/20 p-3 text-xs text-white/70">
      <h3 className="mb-1 text-[11px] font-medium text-white/40">TRANSFERS</h3>
      <div className="space-y-1.5">
        {transfers.map((t) => (
          <div key={t.id} className="flex items-center justify-between gap-2">
            <div className="min-w-0 flex-1 truncate">{t.file_name}</div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="text-white/30">{formatSize(t.size_bytes)}</span>
              <span
                className={`rounded px-1.5 py-0.5 text-[10px] ${
                  t.status === "completed"
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
