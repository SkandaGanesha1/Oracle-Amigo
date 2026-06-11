import { Shield, ShieldAlert } from "lucide-react";
import { OracleTooltip } from "../../components/primitives/OracleTooltip";

interface HashVerifiedBadgeProps {
  verified: boolean;
  sha256: string;
}

export function HashVerifiedBadge({ verified, sha256 }: HashVerifiedBadgeProps) {
  return (
    <OracleTooltip content={
      <div className="space-y-1">
        <p className="text-[10px] font-medium">{verified ? "Hash Verified" : "Hash Mismatch"}</p>
        <p className="font-mono text-[9px] text-oa-text-muted break-all">{sha256}</p>
        {!verified && (
          <p className="text-[9px] text-oa-red">File may have been tampered with during transfer.</p>
        )}
      </div>
    }>
      <span className={`inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-[10px] font-medium ${
        verified
          ? "border-oa-green/20 bg-oa-green/10 text-oa-green"
          : "border-oa-red/20 bg-oa-red/10 text-oa-red"
      }`}>
        {verified ? <Shield className="h-3 w-3" /> : <ShieldAlert className="h-3 w-3" />}
        {verified ? "Verified" : "Tampered"}
      </span>
    </OracleTooltip>
  );
}
