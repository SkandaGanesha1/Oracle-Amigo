import type { FC } from "react";

export const Skeleton: FC<{ rows?: number; className?: string }> = ({ rows = 3, className }) => (
  <div className={`flex flex-col gap-2 ${className ?? ""}`}>
    {Array.from({ length: rows }).map((_, i) => (
      <div
        key={i}
        className="h-4 animate-pulse rounded bg-gradient-to-r from-white/5 via-white/10 to-white/5"
        style={{ width: `${60 + ((i * 17) % 35)}%` }}
      />
    ))}
  </div>
);
