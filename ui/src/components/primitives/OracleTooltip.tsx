import { Tooltip, type TooltipProps } from "@heroui/react";
import type { PropsWithChildren } from "react";

interface OracleTooltipProps extends Omit<TooltipProps, "content"> {
  content: React.ReactNode;
}

export function OracleTooltip({ content, children, ...props }: PropsWithChildren<OracleTooltipProps>) {
  return (
    <Tooltip delay={400} closeDelay={200} {...props}>
      <Tooltip.Trigger>{children}</Tooltip.Trigger>
      <Tooltip.Content className="bg-oa-surface-3 border border-oa-border text-oa-text text-xs px-2.5 py-1.5 rounded-lg">
        {content}
      </Tooltip.Content>
    </Tooltip>
  );
}
