import type { FC, ReactNode } from "react";

export const Card: FC<{ title?: ReactNode; description?: ReactNode; actions?: ReactNode; children: ReactNode; padded?: boolean }> = ({
  title,
  description,
  actions,
  children,
  padded = true
}) => {
  return (
    <section className="rounded-2xl border border-white/10 bg-[#0b0b0d]/80">
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-white/5 px-4 py-3">
          <div className="min-w-0">
            {title && <h2 className="truncate text-xs font-semibold uppercase tracking-wider text-white/80">{title}</h2>}
            {description && <p className="mt-0.5 text-[11px] text-white/45">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
        </header>
      )}
      <div className={padded ? "p-4" : ""}>{children}</div>
    </section>
  );
};
