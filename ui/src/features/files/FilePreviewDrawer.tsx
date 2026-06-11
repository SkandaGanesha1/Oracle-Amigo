import { useEffect, useRef, useState } from "react";
import { X, FileText, Download, Shield } from "lucide-react";
import type { StoredFile } from "../../api/types";
import { formatSize } from "../../lib/format";

interface FilePreviewDrawerProps {
  file: StoredFile | null;
  onClose: () => void;
}

export function FilePreviewDrawer({ file, onClose }: FilePreviewDrawerProps) {
  const [verifyResult, setVerifyResult] = useState<{
    hash_verified: boolean;
    sha256: string;
  } | null>(null);
  const [verifying, setVerifying] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setVerifyResult(null);
  }, [file?.id]);

  useEffect(() => {
    closeRef.current?.focus();
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  if (!file) return null;

  const fileId = file.id;

  async function handleVerify() {
    setVerifying(true);
    try {
      const res = await fetch(`/storage/files/${fileId}/verify`);
      if (res.ok) {
        const data = await res.json() as { hash_verified: boolean; sha256: string };
        setVerifyResult(data);
      }
    } catch { /* ignore */ }
    setVerifying(false);
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="File details"
        className="fixed bottom-0 left-0 right-0 z-50 max-h-[80vh] overflow-y-auto rounded-t-2xl border-t border-oa-border bg-oa-surface-2 p-5 shadow-xl"
      >
        <div className="mx-auto max-w-2xl">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2.5">
              <FileText className="h-5 w-5 text-oa-text-muted" />
              <h2 className="text-sm font-semibold text-oa-text">{file.originalFileName}</h2>
            </div>
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-oa-text-muted hover:bg-oa-surface"
              aria-label="Close preview"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="rounded-lg bg-oa-bg p-2.5">
                <p className="text-oa-text-muted">Size</p>
                <p className="font-medium text-oa-text">{formatSize(file.sizeBytes)}</p>
              </div>
              <div className="rounded-lg bg-oa-bg p-2.5">
                <p className="text-oa-text-muted">Received</p>
                <p className="font-medium text-oa-text">{new Date(file.receivedAt).toLocaleDateString()}</p>
              </div>
            </div>

            <div className="rounded-lg bg-oa-bg p-2.5">
              <p className="text-[10px] text-oa-text-muted mb-0.5">SHA-256</p>
              <p className="font-mono text-[10px] text-oa-text break-all">{file.sha256}</p>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={verifying}
                onClick={handleVerify}
                className="inline-flex items-center gap-1.5 rounded-lg border border-oa-border bg-oa-surface px-3 py-1.5 text-xs text-oa-text-muted transition hover:bg-oa-surface-3 disabled:opacity-50"
              >
                <Shield className="h-3.5 w-3.5" />
                {verifying ? "Verifying..." : "Verify Hash"}
              </button>
              <a
                href={`/storage/files/${file.id}/download`}
                className="inline-flex items-center gap-1.5 rounded-lg bg-oa-blue px-3 py-1.5 text-xs font-medium text-white transition hover:bg-oa-blue/80"
                download
              >
                <Download className="h-3.5 w-3.5" />
                Download
              </a>
            </div>

            {verifyResult && (
              <div className={`rounded-lg border p-2.5 text-xs ${verifyResult.hash_verified ? "border-oa-green/20 bg-oa-green/5 text-oa-green" : "border-oa-red/20 bg-oa-red/5 text-oa-red"}`}>
                <div className="flex items-center gap-1.5">
                  <Shield className="h-3.5 w-3.5" />
                  <span className="font-medium">
                    {verifyResult.hash_verified ? "Hash Verified" : "Hash Mismatch"}
                  </span>
                </div>
                <p className="font-mono text-[10px] mt-1 break-all">{verifyResult.sha256}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
