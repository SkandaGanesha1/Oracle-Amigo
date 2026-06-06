import { useEffect, useState, type FC } from "react";

type AuditEvent = {
  id: number;
  actorAgentId: string;
  taskId: string | null;
  eventType: string;
  detailsJson: Record<string, unknown>;
  previousHash: string;
  eventHash: string;
  createdAt: string;
};

export const AuditTimeline: FC = () => {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [chainValid, setChainValid] = useState<boolean | null>(null);

  useEffect(() => {
    const fetchEvents = async () => {
      try {
        const res = await fetch("/audit/events");
        if (res.ok) {
          const body = (await res.json()) as { events: AuditEvent[]; chainValid?: { valid: boolean } };
          setEvents(body.events);
          if (body.chainValid) setChainValid(body.chainValid.valid);
        }
      } catch { /* ignore */ }
    };
    fetchEvents();
    const interval = setInterval(fetchEvents, 5000);
    return () => clearInterval(interval);
  }, []);

  if (events.length === 0) {
    return (
      <div className="rounded border border-white/10 bg-black/20 p-3 text-xs text-white/40">
        No audit events yet.
      </div>
    );
  }

  return (
    <div className="rounded border border-white/10 bg-black/20 p-3 text-xs text-white/70">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[11px] font-medium text-white/40">AUDIT TIMELINE</h3>
        {chainValid !== null && (
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] ${
              chainValid ? "bg-emerald-500/20 text-emerald-300" : "bg-red-500/20 text-red-300"
            }`}
          >
            Chain: {chainValid ? "VALID" : "BROKEN"}
          </span>
        )}
      </div>
      <div className="space-y-2">
        {events.map((e) => (
          <div key={e.id} className="relative border-l-2 border-white/10 pl-3">
            <div className="flex items-center gap-2">
              <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-mono text-white/50">
                #{e.id}
              </span>
              <span className="font-medium text-white/80">{e.eventType}</span>
            </div>
            <div className="mt-0.5 text-[10px] text-white/35">
              <span>{e.actorAgentId}</span>
              {e.taskId && <span className="ml-2">task: {e.taskId.slice(0, 8)}...</span>}
              <span className="ml-2">{new Date(e.createdAt).toLocaleString()}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
