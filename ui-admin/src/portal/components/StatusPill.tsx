import type { FC, ReactNode } from "react";

type Tone = "neutral" | "green" | "amber" | "red" | "blue" | "violet" | "slate";

const tones: Record<Tone, string> = {
  neutral: "border-white/10 bg-white/5 text-white/80",
  green: "border-emerald-400/20 bg-emerald-400/10 text-emerald-200",
  amber: "border-amber-400/30 bg-amber-400/10 text-amber-200",
  red: "border-rose-400/30 bg-rose-400/10 text-rose-200",
  blue: "border-sky-400/30 bg-sky-400/10 text-sky-200",
  violet: "border-violet-400/30 bg-violet-400/10 text-violet-200",
  slate: "border-white/5 bg-white/5 text-white/55"
};

export const StatusPill: FC<{ tone?: Tone; children: ReactNode; title?: string }> = ({ tone = "neutral", children, title }) => {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${tones[tone]}`}
    >
      {children}
    </span>
  );
};

export function statusTone(value: string | undefined | null): Tone {
  if (!value) return "slate";
  const v = value.toLowerCase();
  if (v === "online" || v === "completed" || v === "delivered" || v === "received" || v === "verified" || v === "ok" || v === "active") return "green";
  if (v === "pending" || v === "submitted" || v === "queued" || v === "uploading" || v === "in_progress" || v === "stale") return "amber";
  if (v === "failed" || v === "rejected" || v === "error" || v === "expired" || v === "canceled" || v === "cancelled" || v === "offline") return "red";
  if (v === "working" || v === "input_required" || v === "auth_required") return "blue";
  if (v === "rejected" || v === "expired") return "red";
  return "neutral";
}
