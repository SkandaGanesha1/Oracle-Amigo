import type { FC, ReactNode } from "react";

export const KV: FC<{ label: ReactNode; value: ReactNode; hint?: ReactNode; mono?: boolean }> = ({ label, value, hint, mono }) => {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wider text-white/40">{label}</span>
      <span className={`text-sm text-white ${mono ? "font-mono" : ""}`}>{value}</span>
      {hint && <span className="text-[10px] text-white/40">{hint}</span>}
    </div>
  );
};
