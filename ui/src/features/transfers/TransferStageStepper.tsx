import { RotateCw, Upload, Download, Shield, FileCheck, AlertCircle } from "lucide-react";
import { cn } from "~/lib/utils";

type Stage = "preparing" | "uploading" | "downloading" | "verifying" | "stored" | "failed";

interface TransferStageStepperProps {
  currentStage: Stage;
}

const stages: { key: Stage; icon: typeof RotateCw; label: string }[] = [
  { key: "preparing", icon: RotateCw, label: "Prepare" },
  { key: "uploading", icon: Upload, label: "Upload" },
  { key: "downloading", icon: Download, label: "Download" },
  { key: "verifying", icon: Shield, label: "Verify" },
  { key: "stored", icon: FileCheck, label: "Stored" },
];

const stageOrder: Stage[] = ["preparing", "uploading", "downloading", "verifying", "stored", "failed"];

export function TransferStageStepper({ currentStage }: TransferStageStepperProps) {
  const currentIdx = stageOrder.indexOf(currentStage);
  const isFailed = currentStage === "failed";

  return (
    <div className="flex items-center gap-0">
      {stages.map((stage, idx) => {
        const Icon = stage.icon;
        const isActive = stageOrder.indexOf(stage.key) === currentIdx;
        const isPast = stageOrder.indexOf(stage.key) < currentIdx && !isFailed;
        const isFuture = stageOrder.indexOf(stage.key) > currentIdx;

        return (
          <div key={stage.key} className="flex items-center">
            <div className="flex flex-col items-center gap-1">
              <div className={cn(
                "flex h-6 w-6 items-center justify-center rounded-full text-[10px] transition-colors",
                isPast && "bg-oa-green/20 text-oa-green",
                isActive && !isFailed && "bg-oa-blue/20 text-oa-blue ring-2 ring-oa-blue/30",
                isActive && isFailed && "bg-oa-red/20 text-oa-red ring-2 ring-oa-red/30",
                isFuture && "bg-oa-surface-2 text-oa-text-disabled",
                isFailed && !isActive && "bg-oa-surface-2 text-oa-text-disabled",
              )}>
                {isPast ? <FileCheck className="h-3 w-3" /> : <Icon className={cn("h-3 w-3", isActive && !isFailed && "animate-pulse")} />}
              </div>
              <span className={cn(
                "text-[9px] whitespace-nowrap",
                isPast && "text-oa-green",
                isActive && !isFailed && "text-oa-blue",
                (isFuture || isFailed) && "text-oa-text-disabled",
              )}>
                {stage.label}
              </span>
            </div>
            {idx < stages.length - 1 && (
              <div className={cn(
                "mx-0.5 mb-5 h-px w-6",
                isPast ? "bg-oa-green/30" : "bg-oa-border"
              )} />
            )}
          </div>
        );
      })}
      {isFailed && (
        <div className="flex items-center">
          <div className="mx-0.5 mb-5 h-px w-6 bg-oa-red/30" />
          <div className="flex flex-col items-center gap-1">
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-oa-red/20 text-oa-red ring-2 ring-oa-red/30">
              <AlertCircle className="h-3 w-3" />
            </div>
            <span className="text-[9px] text-oa-red whitespace-nowrap">Failed</span>
          </div>
        </div>
      )}
    </div>
  );
}
