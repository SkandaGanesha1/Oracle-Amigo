import { ShieldCheck } from "lucide-react";

interface ApprovalExactBindingProps {
  fileName: string;
  filePath: string;
}

export function ApprovalExactBinding({ fileName, filePath }: ApprovalExactBindingProps) {
  return (
    <div className="rounded-lg border border-oa-blue/20 bg-oa-blue/5 p-2.5">
      <div className="flex items-start gap-2">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-oa-blue" />
        <div className="space-y-0.5">
          <p className="text-[11px] font-medium text-oa-text">Exact file binding</p>
          <p className="text-[10px] text-oa-text-muted leading-relaxed">
            <span className="font-medium text-oa-text">{fileName}</span>
            <br />
            <span className="font-mono">{filePath}</span>
          </p>
          <p className="text-[10px] text-oa-text-disabled">
            Only this specific file will be sent. No other files on your device are affected.
          </p>
        </div>
      </div>
    </div>
  );
}
