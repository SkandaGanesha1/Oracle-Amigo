import { Fingerprint } from "lucide-react";

export function BiometricApproveButton({ onApprove }: { onApprove?: () => void }) {
  return (
    <button type="button" onClick={onApprove} className="inline-flex items-center gap-2 rounded-xl border border-oa-border bg-oa-surface-2 px-3 py-2 text-xs text-oa-text">
      <Fingerprint className="h-3.5 w-3.5 text-oa-purple" />
      Use biometric approval
    </button>
  );
}
