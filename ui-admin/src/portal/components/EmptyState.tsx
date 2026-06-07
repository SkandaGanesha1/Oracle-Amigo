import type { FC, ReactNode } from "react";

export const EmptyState: FC<{ title: string; description?: ReactNode; icon?: ReactNode }> = ({ title, description, icon }) => (
  <div className="flex flex-col items-center justify-center gap-2 py-12 text-center text-white/55">
    {icon && <div className="text-white/40">{icon}</div>}
    <p className="text-sm font-medium text-white/75">{title}</p>
    {description && <p className="max-w-md text-xs text-white/50">{description}</p>}
  </div>
);
