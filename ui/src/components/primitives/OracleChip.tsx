import type { PropsWithChildren } from "react";
import type { ChipVariants } from "@heroui/styles";
import { cn } from "~/lib/utils";

type OAChipColor = "accent" | "danger" | "default" | "success" | "warning";

interface OracleChipProps {
  color?: OAChipColor;
  className?: string;
}

const colorClasses: Record<OAChipColor, string> = {
  success: "bg-oa-green/15 text-oa-green",
  warning: "bg-oa-amber/15 text-oa-amber",
  accent: "bg-oa-blue/15 text-oa-blue",
  danger: "bg-oa-red/15 text-oa-red",
  default: "bg-oa-surface-2 text-oa-text-muted",
};

export function OracleChip({ color = "default", className, children }: PropsWithChildren<OracleChipProps>) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-lg px-2 py-0.5 text-xs font-medium", colorClasses[color], className)}>
      {children}
    </span>
  );
}
