import React from "react";
import { Activity, AlertCircle } from "lucide-react";
import type { TransferProgressMessage } from "../../api/types";
import { TransferStageStepper } from "./TransferStageStepper";
import { HashVerifiedBadge } from "./HashVerifiedBadge";
import { formatSize } from "../../lib/format";

interface TransferProgressCardProps {
  transfer: TransferProgressMessage;
}

export function TransferProgressCard({ transfer }: TransferProgressCardProps) {
  const progress = Math.min(100, Math.max(0, transfer.progress_percent));
  const isFailed = transfer.status === "failed";
  const isComplete = transfer.status === "stored" || transfer.status === "available";

  return (
    <div className="rounded-xl card-transfer-progress border p-4" role="region" aria-label={`File transfer: ${transfer.file_name}`}>
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-oa-text-muted">
              File Transfer
            </h3>
            <p className="mt-1 text-sm font-medium text-oa-text">{transfer.file_name}</p>
            <p className="text-[11px] text-oa-text-muted">
              {formatSize(transfer.size_bytes)}
            </p>
          </div>
          <HashVerifiedBadge verified={isComplete} sha256={transfer.sha256} />
        </div>

        <TransferStageStepper currentStage={transfer.status as any} />

        <div role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label={`Transfer progress ${progress}%`}>
          <div className="flex items-center justify-between text-[10px] text-oa-text-muted mb-1">
            <span>Progress</span>
            <span>{progress}%</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-oa-bg">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                isFailed ? "bg-oa-red" : isComplete ? "bg-oa-green" : "bg-oa-blue"
              }`}
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {!isComplete && !isFailed && (
          <div className="flex items-center gap-1.5 text-[10px] text-oa-text-muted">
            <Activity className="h-3 w-3" />
            {transfer.status === "uploading" && "Transferring to recipient..."}
            {transfer.status === "downloading" && "Receiving from sender..."}
            {transfer.status === "verifying" && "Verifying file integrity..."}
            {transfer.status === "preparing" && "Preparing file for transfer..."}
          </div>
        )}

        {isFailed && (
          <p className="text-[10px] text-oa-red flex items-center gap-1">
            <AlertCircle className="h-3 w-3" />
            Transfer failed
          </p>
        )}

        <div className="flex flex-wrap gap-1.5">
          <span className="font-mono text-[10px] text-oa-text-disabled">
            SHA-256: {transfer.sha256.slice(0, 16)}...
          </span>
        </div>
      </div>
    </div>
  );
}
