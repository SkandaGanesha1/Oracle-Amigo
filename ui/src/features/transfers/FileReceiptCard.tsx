import { FileCheck, User, HardDrive, ExternalLink } from "lucide-react";
import type { FileReceiptMessage } from "../../api/types";
import { HashVerifiedBadge } from "./HashVerifiedBadge";
import { RelayEncryptedBadge } from "./RelayEncryptedBadge";
import { LocalPathHiddenBadge } from "./LocalPathHiddenBadge";
import { formatSize } from "../../lib/format";

interface FileReceiptCardProps {
  receipt: FileReceiptMessage;
}

export function FileReceiptCard({ receipt }: FileReceiptCardProps) {
  return (
    <div className="rounded-xl border border-oa-border bg-oa-surface p-4">
      <div className="flex items-start gap-3">
        <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${receipt.hash_verified ? "bg-oa-green/10" : "bg-oa-amber/10"}`}>
          <FileCheck className={`h-4 w-4 ${receipt.hash_verified ? "text-oa-green" : "text-oa-amber"}`} />
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-oa-text-muted">
                File Received
              </h3>
              <p className="mt-1 text-sm font-medium text-oa-text">{receipt.file_name}</p>
            </div>
            <HashVerifiedBadge verified={receipt.hash_verified} sha256={receipt.sha256} />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-xs text-oa-text-muted">
              <User className="h-3 w-3 shrink-0" />
              <span>From: {receipt.sender}</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-oa-text-muted">
              <HardDrive className="h-3 w-3 shrink-0" />
              <span className="truncate">{receipt.stored_path_display}</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-oa-text-muted">
              <span className="font-mono">{formatSize(receipt.size_bytes)}</span>
              <span className="text-oa-text-disabled">&middot;</span>
              <span className="font-mono text-[10px]">{receipt.sha256.slice(0, 20)}...</span>
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5">
            <RelayEncryptedBadge />
            <LocalPathHiddenBadge />
          </div>

          {!receipt.hash_verified && (
            <div className="rounded-lg border border-oa-amber/20 bg-oa-amber/5 p-2 text-[10px] text-oa-amber">
              Hash verification failed. The file may have been tampered with during transfer.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
