import { EyeOff } from "lucide-react";
import { OracleTooltip } from "../../components/primitives/OracleTooltip";

export function LocalPathHiddenBadge() {
  return (
    <OracleTooltip content="Local file path is hidden from the remote agent to protect your privacy">
      <span className="inline-flex items-center gap-1 rounded-lg border border-oa-purple/20 bg-oa-purple/10 px-2 py-0.5 text-[10px] font-medium text-oa-purple">
        <EyeOff className="h-3 w-3" />
        Path Hidden
      </span>
    </OracleTooltip>
  );
}
