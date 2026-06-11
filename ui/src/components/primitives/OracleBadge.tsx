import type { PropsWithChildren } from "react";
import type { BadgeVariants } from "@heroui/styles";
import { Badge } from "@heroui/react/badge";
import { cn } from "~/lib/utils";

type OABadgeColor = "accent" | "danger" | "default" | "success" | "warning";

type BadgePlacement = BadgeVariants["placement"];

interface OracleBadgeProps {
  color?: OABadgeColor;
  dot?: boolean;
  anchor?: boolean;
  placement?: BadgePlacement;
  className?: string;
}

const colorClasses: Record<OABadgeColor, string> = {
  success: "bg-oa-green/15 text-oa-green border border-oa-green/20",
  warning: "bg-oa-amber/15 text-oa-amber border border-oa-amber/20",
  accent: "bg-oa-blue/15 text-oa-blue border border-oa-blue/20",
  danger: "bg-oa-red/15 text-oa-red border border-oa-red/20",
  default: "bg-oa-surface-2 text-oa-text-muted border border-oa-border",
};

const dotClasses: Record<OABadgeColor, string> = {
  success: "bg-oa-green",
  warning: "bg-oa-amber",
  accent: "bg-oa-blue",
  danger: "bg-oa-red",
  default: "bg-oa-text-disabled",
};

export function OracleBadge({ color = "default", dot, anchor, placement = "bottom-right", className, children }: PropsWithChildren<OracleBadgeProps>) {
  if (anchor) {
    return (
      <Badge.Anchor className={className}>
        {children}
        <Badge color={color} placement={placement} size="sm" />
      </Badge.Anchor>
    );
  }

  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium", colorClasses[color], className)}>
      {dot && <span className={cn("h-1.5 w-1.5 rounded-full", dotClasses[color])} />}
      {children}
    </span>
  );
}
