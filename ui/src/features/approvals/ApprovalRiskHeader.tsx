import { AlertTriangle, Shield, ShieldCheck, ShieldAlert } from "lucide-react";

interface ApprovalRiskHeaderProps {
  requester: string;
  requestText: string;
  fileName?: string;
}

function estimateRiskLevel(fileName?: string): { level: "Low" | "Medium" | "High"; icon: typeof Shield; color: string; bg: string; explanation: string } {
  if (!fileName) return { level: "Medium", icon: Shield, color: "text-oa-amber", bg: "bg-oa-amber/5", explanation: "No file details available" };
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  const highRisk = ["exe", "dll", "bat", "sh", "ps1", "vbs", "msi", "scr", "com"];
  const mediumRisk = ["doc", "docx", "xls", "xlsx", "pdf", "zip", "rar", "7z"];
  if (highRisk.includes(ext)) return { level: "High", icon: ShieldAlert, color: "text-oa-red", bg: "bg-oa-red/5", explanation: "Executable files can run code on your device" };
  if (mediumRisk.includes(ext)) return { level: "Medium", icon: Shield, color: "text-oa-amber", bg: "bg-oa-amber/5", explanation: "This file type may contain macros or scripts" };
  return { level: "Low", icon: ShieldCheck, color: "text-oa-green", bg: "bg-oa-green/5", explanation: "Standard data file — low risk" };
}

export function ApprovalRiskHeader({ requester, requestText, fileName }: ApprovalRiskHeaderProps) {
  const risk = estimateRiskLevel(fileName);
  const RiskIcon = risk.icon;

  return (
    <div className={`rounded-lg border ${risk.bg.replace("bg-", "border-").replace("/5", "/20")} ${risk.bg} p-3`}>
      <div className="flex items-start gap-2.5">
        <div className={`mt-0.5 flex h-5 w-5 items-center justify-center rounded-full ${risk.color.replace("text-", "bg-").replace("oa-", "oa-")}/20`}>
          <RiskIcon className={`h-3 w-3 ${risk.color}`} />
        </div>
        <div className="space-y-1 flex-1">
          <div className="flex items-center gap-2">
            <span className={`text-xs font-semibold uppercase ${risk.color}`}>{risk.level} Risk</span>
            <span className="text-[10px] text-oa-text-muted">{risk.explanation}</span>
          </div>
          <p className="text-xs font-medium text-oa-amber">Approving will send this file to this agent</p>
          <p className="text-[10px] text-oa-text-muted leading-relaxed">
            <span className="font-medium text-oa-text">{requester}</span> requested: &ldquo;<span className="break-words">{requestText}</span>&rdquo;
          </p>
        </div>
      </div>
    </div>
  );
}
