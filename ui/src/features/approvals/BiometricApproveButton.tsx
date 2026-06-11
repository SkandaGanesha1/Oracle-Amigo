import { Fingerprint } from "lucide-react";
import { useBiometricCapability } from "../../hooks/queries";

interface BiometricApproveButtonProps {
  onApprove: () => void;
  disabled?: boolean;
}

export function BiometricApproveButton({ onApprove, disabled }: BiometricApproveButtonProps) {
  const { data } = useBiometricCapability();
  const available = Boolean(data?.available);

  return (
    <button
      type="button"
      onClick={onApprove}
      disabled={disabled}
      className={`flex min-h-[48px] items-center justify-center gap-2 rounded-lg border px-4 text-sm font-medium transition disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue ${
        available
          ? "border-oa-green/30 bg-oa-green/10 text-oa-green hover:bg-oa-green/15"
          : "border-oa-border bg-oa-surface-2 text-oa-text hover:bg-oa-surface"
      }`}
      title={available ? "Biometric approval available. This phase still uses the existing approval backend path." : "Biometric capability not available in this browser"}
    >
      <Fingerprint className="h-4 w-4" />
      {available ? "Biometric approval available" : "Approve"}
    </button>
  );
}
