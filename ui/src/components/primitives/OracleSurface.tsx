import type { HTMLAttributes, PropsWithChildren } from "react";
import { cn } from "~/lib/utils";

type SurfaceElevation = "base" | "elevated" | "card" | "dialog";

interface OracleSurfaceProps extends HTMLAttributes<HTMLDivElement> {
  elevation?: SurfaceElevation;
}

const elevationStyles: Record<SurfaceElevation, string> = {
  base: "bg-oa-bg",
  elevated: "bg-oa-bg-elevated border border-oa-border rounded-xl",
  card: "bg-oa-surface border border-oa-border rounded-xl",
  dialog: "bg-oa-surface-2 border border-oa-border-strong rounded-2xl shadow-lg",
};

export function OracleSurface({ elevation = "card", className, children, ...props }: PropsWithChildren<OracleSurfaceProps>) {
  return (
    <div className={cn(elevationStyles[elevation], className)} {...props}>
      {children}
    </div>
  );
}
