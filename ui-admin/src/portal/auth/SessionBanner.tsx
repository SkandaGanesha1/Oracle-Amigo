import { LogOut, ShieldCheck, Timer } from "lucide-react";
import { useEffect, useState, type FC } from "react";
import { logout as apiLogout } from "./api";
import type { SessionState } from "./useSession";

interface Props {
  session: SessionState;
}

function formatSecondsLeft(seconds: number): string {
  if (seconds <= 0) return "expired";
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return `${m}m ${s.toString().padStart(2, "0")}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${(m % 60).toString().padStart(2, "0")}m`;
}

export const SessionBanner: FC<Props> = ({ session }) => {
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const idleSeconds = session.idleExpiresAt
    ? Math.max(0, Math.floor((session.idleExpiresAt - now) / 1000))
    : 0;
  const absoluteSeconds = session.absoluteExpiresAt
    ? Math.max(0, Math.floor((session.absoluteExpiresAt - now) / 1000))
    : 0;

  const signOut = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await apiLogout();
    } catch {
      // Even if logout fails server-side, drop client state
    } finally {
      session.clear("Signed out.");
      setBusy(false);
    }
  };

  return (
    <div className="flex h-10 shrink-0 items-center justify-between border-b border-white/10 bg-[#070708]/60 px-4 text-[11px] text-white/65">
      <div className="flex items-center gap-3">
        <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-400/20 bg-emerald-400/10 px-2 py-0.5 text-emerald-200">
          <ShieldCheck className="h-3 w-3" /> {session.user?.email ?? "Authenticated"}
        </span>
        <span className="hidden text-white/40 md:inline">{session.user?.display_name ?? ""}</span>
      </div>
      <div className="flex items-center gap-3">
        <span className="inline-flex items-center gap-1.5 text-white/55" title="Time until this session goes idle">
          <Timer className="h-3 w-3" /> idle {formatSecondsLeft(idleSeconds)}
        </span>
        <span
          className="hidden text-white/35 md:inline"
          title="Time until this session must be re-authenticated from scratch"
        >
          / max {formatSecondsLeft(absoluteSeconds)}
        </span>
        <button
          type="button"
          onClick={signOut}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-md border border-rose-400/20 bg-rose-400/10 px-2 py-1 text-rose-200 transition hover:bg-rose-400/20 disabled:opacity-60"
          title="Sign out"
        >
          <LogOut className="h-3 w-3" /> Sign out
        </button>
      </div>
    </div>
  );
};
