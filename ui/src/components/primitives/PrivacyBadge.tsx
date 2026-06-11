import type { PrivacyBoundary } from "../../types";
import { Lock, ArrowRight, Globe, RefreshCwOff, Copy } from "lucide-react";

interface PrivacyBadgeProps {
  boundary: PrivacyBoundary;
  className?: string;
}

const privacyConfig: Record<
  PrivacyBoundary,
  { icon: typeof Lock; color: string; bg: string; label: string; description: string }
> = {
  "local-only": {
    icon: Lock,
    color: "text-oa-green",
    bg: "bg-oa-green/10",
    label: "Local only",
    description: "Data stays on your device and is not shared externally",
  },
  "leaving-device": {
    icon: ArrowRight,
    color: "text-oa-amber",
    bg: "bg-oa-amber/10",
    label: "Leaving device",
    description: "Data is being sent externally to another agent",
  },
  "shared-externally": {
    icon: Globe,
    color: "text-oa-blue",
    bg: "bg-oa-blue/10",
    label: "Shared externally",
    description: "Data has been shared with a remote agent",
  },
  "revocable": {
    icon: RefreshCwOff,
    color: "text-oa-purple",
    bg: "bg-oa-purple/10",
    label: "Revocable",
    description: "Access can be revoked at any time",
  },
  "permanent-copy": {
    icon: Copy,
    color: "text-oa-red",
    bg: "bg-oa-red/10",
    label: "Permanent copy",
    description: "A permanent copy has been made and cannot be revoked",
  },
};

export function PrivacyBadge({ boundary, className = "" }: PrivacyBadgeProps) {
  const config = privacyConfig[boundary];
  const Icon = config.icon;

  return (
    <div
      className={`inline-flex items-center gap-1.5 rounded px-2 py-1 ${config.bg} ${config.color} ${className}`}
      title={config.description}
      role="status"
      aria-label={`Privacy: ${config.label} - ${config.description}`}
    >
      <Icon className="h-3 w-3" />
      <span className="text-[10px] font-medium uppercase tracking-wider">{config.label}</span>
    </div>
  );
}
