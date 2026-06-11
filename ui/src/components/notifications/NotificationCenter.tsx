import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Bell, CheckCircle2, ShieldAlert, X } from "lucide-react";
import { useNotifications } from "../../hooks/queries";

const severityClass: Record<string, string> = {
  info: "text-oa-blue",
  success: "text-oa-green",
  warning: "text-oa-amber",
  error: "text-oa-red",
};

export function NotificationCenter() {
  const [open, setOpen] = useState(false);
  const { data } = useNotifications();
  const events = data?.events ?? [];
  const unread = events.filter((event) => !event.delivered).length;

  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener("oa-open-notifications", handler);
    return () => window.removeEventListener("oa-open-notifications", handler);
  }, []);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="relative flex h-10 w-10 items-center justify-center rounded-lg border border-oa-border bg-oa-surface/70 text-oa-text-muted hover:text-oa-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue"
        aria-label="Open notification center"
      >
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-oa-amber ring-2 ring-oa-bg" />
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            className="glass-panel-strong absolute right-0 top-12 z-50 w-[360px] overflow-hidden rounded-xl"
          >
            <div className="flex items-center justify-between border-b border-oa-border px-3 py-2.5">
              <div>
                <p className="text-xs font-semibold text-oa-text">Notifications</p>
                <p className="text-[10px] text-oa-text-muted">Approvals, transfers, policy, and mission events</p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-oa-text-muted hover:bg-oa-surface"
                aria-label="Close notifications"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="max-h-96 overflow-y-auto p-2">
              {events.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-8 text-center">
                  <CheckCircle2 className="h-7 w-7 text-oa-text-muted" />
                  <p className="text-xs text-oa-text-muted">No notification events yet</p>
                </div>
              ) : (
                events.map((event) => (
                  <div key={event.id} className="flex gap-3 rounded-lg border border-oa-border bg-oa-bg-elevated p-3">
                    <ShieldAlert className={`mt-0.5 h-4 w-4 shrink-0 ${severityClass[event.severity] ?? "text-oa-text-muted"}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-xs font-medium text-oa-text">{event.title}</p>
                        <span className="shrink-0 text-[9px] text-oa-text-disabled">
                          {new Date(event.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-[10px] text-oa-text-muted">{event.body}</p>
                      <p className="mt-1 text-[9px] uppercase tracking-wider text-oa-text-disabled">{event.eventType}</p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
