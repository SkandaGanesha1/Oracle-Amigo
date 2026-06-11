import { useEffect, useState, useCallback, useRef } from "react";
import { motion } from "framer-motion";
import { Shield, ShieldCheck, ShieldAlert, User, HardDrive, Clock, Ban, X, FileText, AlertTriangle, ExternalLink, Key, Globe, ArrowRight, Infinity, Eye } from "lucide-react";
import { useConsent, useConsentAction } from "../../hooks/queries";
import { ApprovalPolicyBadge } from "./ApprovalPolicyBadge";
import { ApprovalRiskHeader } from "./ApprovalRiskHeader";
import { usePendingApprovals } from "../../hooks/queries";
import { BiometricApproveButton } from "./BiometricApproveButton";
import { RedactionEditor } from "./RedactionEditor";
import type { FileCandidateApprovalCard } from "../../api/types";

interface ConsentConsoleProps {
  approvalId: string | null;
  onClose: () => void;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatRemaining(expiresAt: string): string {
  const remaining = new Date(expiresAt).getTime() - Date.now();
  if (remaining <= 0) return "Expired";
  const mins = Math.floor(remaining / 60000);
  const hrs = Math.floor(mins / 60);
  return hrs > 0 ? `${hrs}h ${mins % 60}m` : `${mins}m`;
}

export function ConsentConsole({ approvalId, onClose }: ConsentConsoleProps) {
  const { approvalCards } = usePendingApprovals();
  const card = approvalCards.find((c) => c.approval_id === approvalId) ?? null;
  const { data: consent } = useConsent(approvalId);
  const consentAction = useConsentAction();

  const [selectedAccessType, setSelectedAccessType] = useState<"one-time" | "time-bound" | "permanent">("one-time");
  const [expiryHours, setExpiryHours] = useState(24);
  const [isRevoking, setIsRevoking] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    containerRef.current?.focus();
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const focusable = el.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const trap = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    el.addEventListener("keydown", trap);
    return () => el.removeEventListener("keydown", trap);
  }, [approvalId, card]);

  const handleApprove = useCallback(() => {
    if (!approvalId) return;
    consentAction.mutate({
      consentId: approvalId,
      action: "approve",
      accessType: selectedAccessType,
      expiresInHours: selectedAccessType === "time-bound" ? expiryHours : undefined,
    });
  }, [approvalId, consentAction, selectedAccessType, expiryHours]);

  const handleReject = useCallback(() => {
    if (!approvalId) return;
    consentAction.mutate({ consentId: approvalId, action: "reject" });
  }, [approvalId, consentAction]);

  const handleRevoke = useCallback(() => {
    if (!approvalId) return;
    setIsRevoking(true);
    consentAction.mutate(
      { consentId: approvalId, action: "revoke" },
      { onSettled: () => setIsRevoking(false) }
    );
  }, [approvalId, consentAction]);

  if (!approvalId || !card) {
    return (
      <div className="flex h-full w-80 shrink-0 flex-col border-l border-oa-border bg-oa-surface">
        <div className="flex items-center justify-between border-b border-oa-border px-4 py-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-oa-text-muted">
            <span className="flex items-center gap-1.5">
              <Shield className="h-3.5 w-3.5" />
              Consent Console
            </span>
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="flex min-h-[48px] min-w-[48px] items-center justify-center text-oa-text-muted hover:text-oa-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue"
            aria-label="Close consent console"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex flex-1 items-center justify-center px-4">
          <div className="flex flex-col items-center gap-2 text-center">
            <Shield className="h-8 w-8 text-oa-text-muted" />
            <p className="text-sm text-oa-text-muted">Select an approval to view details</p>
          </div>
        </div>
      </div>
    );
  }

  const selectedFile = card.candidates.find((c) => c.candidate_id === card.selected_candidate_id) ?? card.candidates[0];
  const isTerminal = card.status !== "pending" && card.status !== "feedback_requested";
  const requesterLabel = /^ag[ei]_[a-f0-9-]{36,}$/i.test(card.requester.trim()) ? "Remote agent" : card.requester;

  return (
    <motion.div
      ref={containerRef}
      tabIndex={-1}
      initial={{ width: 0, opacity: 0 }}
      animate={{ width: 320, opacity: 1 }}
      exit={{ width: 0, opacity: 0 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className="flex h-full w-80 shrink-0 flex-col border-l border-oa-border bg-oa-surface overflow-y-auto"
    >
      <div className="flex items-center justify-between border-b border-oa-border px-4 py-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-oa-text-muted">
          <span className="flex items-center gap-1.5">
            <Shield className="h-3.5 w-3.5" />
            Consent Details
          </span>
        </h3>
        <button
          type="button"
          onClick={onClose}
          className="flex min-h-[48px] min-w-[48px] items-center justify-center text-oa-text-muted hover:text-oa-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 space-y-4 p-4">
        <section>
          <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-oa-text-disabled">Requester</h4>
          <div className="space-y-2">
            <div className="flex items-start gap-3 rounded-lg border border-oa-border bg-oa-bg-elevated p-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-oa-blue/10">
                <User className="h-4 w-4 text-oa-blue" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-oa-text">{requesterLabel}</p>
                <p className="text-[10px] text-oa-text-muted font-mono truncate">{card.requester}</p>
              </div>
            </div>
            {consent?.recipientAgentVerified && (
              <div className="flex items-center gap-1.5 text-[10px] text-oa-green">
                <ShieldCheck className="h-3 w-3" />
                Verified agent identity
              </div>
            )}
          </div>
        </section>

        <section>
          <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-oa-text-disabled">File Details</h4>
          <div className="space-y-2">
            {selectedFile && (
              <div className="rounded-lg border border-oa-border bg-oa-bg-elevated p-3">
                <div className="flex items-start gap-2">
                  <FileText className="mt-0.5 h-4 w-4 shrink-0 text-oa-text-muted" />
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium text-oa-text">{selectedFile.file_name}</p>
                    <p className="truncate text-[10px] text-oa-text-muted">{selectedFile.display_path}</p>
                    <p className="mt-1 text-[10px] text-oa-text-muted">{formatSize(selectedFile.size_bytes)} &middot; {selectedFile.extension || "unknown"}</p>
                    <div className="mt-1">
                      <ApprovalPolicyBadge safetyLabels={selectedFile.safety_labels} />
                    </div>
                  </div>
                </div>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded border border-oa-border bg-oa-surface-2 px-2 py-1 text-[10px] text-oa-text-muted hover:bg-oa-surface"
                  >
                    <Eye className="h-3 w-3" />
                    Preview
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>

        <ApprovalRiskHeader
          requester={requesterLabel}
          requestText={card.request_text}
          fileName={selectedFile?.file_name}
        />

        <RedactionEditor file={selectedFile} recipientDisplayName={requesterLabel} />

        <section>
          <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-oa-text-disabled">Data Movement</h4>
          <div className="flex items-center gap-2 rounded-lg border border-oa-amber/20 bg-oa-amber/5 p-3">
            <ArrowRight className="h-4 w-4 shrink-0 text-oa-amber" />
            <div className="text-[10px] text-oa-text-muted">
              <span className="font-medium text-oa-text">Local device</span>
              <span className="mx-1">&rarr;</span>
              <span className="font-medium text-oa-text">{requesterLabel}</span>
              <p className="mt-0.5 text-oa-amber">Data will leave your device</p>
            </div>
          </div>
        </section>

        {card.expires_at && (
          <section>
            <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-oa-text-disabled">Expiry</h4>
            <div className="flex items-center gap-2 rounded-lg border border-oa-border bg-oa-bg-elevated p-3">
              <Clock className="h-4 w-4 shrink-0 text-oa-text-muted" />
              <div className="text-xs text-oa-text-muted">
                <p>Expires in <span className="font-medium text-oa-text">{formatRemaining(card.expires_at)}</span></p>
                <p className="text-[10px] text-oa-text-disabled">{new Date(card.expires_at).toLocaleString()}</p>
              </div>
            </div>
          </section>
        )}

        {!isTerminal && (
          <section>
            <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-oa-text-disabled">Access Type</h4>
            <div className="space-y-2">
              {(["one-time", "time-bound", "permanent"] as const).map((type) => (
                <label
                  key={type}
                  className={`flex min-h-[48px] cursor-pointer items-center gap-3 rounded-lg border p-3 transition ${
                    selectedAccessType === type
                      ? "border-oa-blue/40 bg-oa-blue/5"
                      : "border-oa-border hover:border-oa-border-strong"
                  }`}
                >
                  <input
                    type="radio"
                    name="access-type"
                    checked={selectedAccessType === type}
                    onChange={() => setSelectedAccessType(type)}
                    className="h-3 w-3 accent-oa-blue"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-oa-text">
                      {type === "one-time" ? "One-time access" : type === "time-bound" ? "Time-bound access" : "Permanent access"}
                    </p>
                    <p className="text-[10px] text-oa-text-muted">
                      {type === "one-time" ? "Single file access, expires after transfer" :
                       type === "time-bound" ? "Access expires after a set time" :
                       "Ongoing access until revoked"}
                    </p>
                  </div>
                </label>
              ))}
              {selectedAccessType === "time-bound" && (
                <div className="flex items-center gap-2 px-1">
                  <span className="text-[10px] text-oa-text-muted">Expires in</span>
                  {[1, 6, 12, 24, 48, 72].map((h) => (
                    <button
                      key={h}
                      type="button"
                      onClick={() => setExpiryHours(h)}
                      className={`rounded px-2 py-1 text-[10px] font-medium transition ${
                        expiryHours === h ? "bg-oa-blue/20 text-oa-blue" : "text-oa-text-muted hover:bg-oa-surface-2"
                      }`}
                    >
                      {h}h
                    </button>
                  ))}
                </div>
              )}
            </div>
          </section>
        )}

        <div className="flex flex-col gap-2">
          {!isTerminal ? (
            <>
              <BiometricApproveButton onApprove={handleApprove} disabled={consentAction.isPending} />
              <button
                type="button"
                onClick={handleReject}
                disabled={consentAction.isPending}
                className="flex min-h-[48px] items-center justify-center gap-2 rounded-lg border border-oa-border bg-oa-surface-2 px-4 text-sm font-medium text-oa-text transition hover:bg-oa-surface disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue"
              >
                <X className="h-4 w-4" />
                Reject
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={handleRevoke}
              disabled={isRevoking}
              className="flex min-h-[48px] items-center justify-center gap-2 rounded-lg border border-oa-red/30 bg-oa-red/5 px-4 text-sm font-medium text-oa-red transition hover:bg-oa-red/10 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue"
            >
              <Ban className="h-4 w-4" />
              Revoke access
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
}
