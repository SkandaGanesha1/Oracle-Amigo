import { Lock } from "lucide-react";
import { OracleTooltip } from "../../components/primitives/OracleTooltip";

export function RelayEncryptedBadge() {
  return (
    <OracleTooltip content="File was transferred via encrypted relay channel (AES-128-GCM)">
      <span className="inline-flex items-center gap-1 rounded-lg border border-oa-blue/20 bg-oa-blue/10 px-2 py-0.5 text-[10px] font-medium text-oa-blue">
        <Lock className="h-3 w-3" />
        Relay Encrypted
      </span>
    </OracleTooltip>
  );
}
