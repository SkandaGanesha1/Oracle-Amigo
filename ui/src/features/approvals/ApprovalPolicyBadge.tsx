import { Shield, AlertTriangle, Eye } from "lucide-react";
import { OracleTooltip } from "../../components/primitives/OracleTooltip";

interface ApprovalPolicyBadgeProps {
  safetyLabels?: string[];
}

const iconMap: Record<string, typeof Shield> = {
  "Approval required": Shield,
  "Local path hidden from recipient": Eye,
  "Safety check": AlertTriangle,
};

export function ApprovalPolicyBadge({ safetyLabels }: ApprovalPolicyBadgeProps) {
  if (!safetyLabels || safetyLabels.length === 0) return null;

  const primary = safetyLabels[0];
  const Icon = iconMap[primary] ?? Shield;

  return (
    <OracleTooltip content={
      <div className="space-y-1 max-w-[200px]">
        {safetyLabels.map((label) => (
          <div key={label} className="text-[10px] leading-relaxed">{label}</div>
        ))}
      </div>
    }>
      <span className="inline-flex items-center gap-1 rounded-lg border border-oa-amber/20 bg-oa-amber/10 px-2 py-0.5 text-[10px] font-medium text-oa-amber">
        <Icon className="h-3 w-3" />
        {primary}
      </span>
    </OracleTooltip>
  );
}
