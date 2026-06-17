/**
 * VoiceCommandCard
 *
 * Shown in the Chat UI timeline when a voice command has been submitted.
 * Tracks the full lifecycle: parsing → preview → submitted → waiting receiver
 * → receiver approval → transferring → completed / failed.
 *
 * Used by StreamLikeChat.tsx for messages with messageType === "voice_command".
 */
import { useState } from "react";
import { useConfirmVoiceCommand, useCancelVoiceCommand } from "../../hooks/queries";
import type { VoiceCommandRecord } from "../../types";

export interface VoiceCommandCardProps {
  record: VoiceCommandRecord;
  onRefresh?: () => void;
}

const STATUS_LABEL: Record<string, string> = {
  captured: "Captured",
  transcribed: "Transcribed",
  parsed: "Parsed",
  preview_required: "Review required",
  confirmed: "Confirmed",
  submitted: "Submitted",
  waiting_remote_agent: "Waiting for receiver agent…",
  waiting_receiver_approval: "Waiting for receiver approval…",
  transferring: "Transferring file…",
  running: "Running",
  completed: "Completed ✓",
  failed: "Failed",
  cancelled: "Cancelled"
};

const STATUS_COLOR: Record<string, string> = {
  preview_required: "#f59e0b",
  submitted: "#3b82f6",
  waiting_remote_agent: "#6366f1",
  waiting_receiver_approval: "#8b5cf6",
  transferring: "#06b6d4",
  completed: "#10b981",
  failed: "#ef4444",
  cancelled: "#6b7280"
};

export function VoiceCommandCard({ record, onRefresh }: VoiceCommandCardProps) {
  const [expanded, setExpanded] = useState(false);
  const confirmMutation = useConfirmVoiceCommand();
  const cancelMutation = useCancelVoiceCommand();

  const status = record.status;
  const statusColor = STATUS_COLOR[status] ?? "#6b7280";
  const statusLabel = STATUS_LABEL[status] ?? status;
  const preview = record.preview;
  const parsed = record.parsed;
  const isActionable = status === "preview_required" && !preview?.error;
  const isTerminal = status === "completed" || status === "failed" || status === "cancelled";

  async function handleConfirm() {
    await confirmMutation.mutateAsync({ commandId: record.id });
    onRefresh?.();
  }

  async function handleCancel() {
    await cancelMutation.mutateAsync(record.id);
    onRefresh?.();
  }

  return (
    <div
      id={`voice-cmd-${record.id}`}
      style={{
        border: `1px solid ${statusColor}44`,
        borderLeft: `3px solid ${statusColor}`,
        borderRadius: "10px",
        padding: "12px 14px",
        margin: "4px 0",
        background: "rgba(0,0,0,0.15)",
        maxWidth: "480px",
        fontFamily: "inherit"
      }}
    >
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
        <MicIcon color={statusColor} />
        <span style={{ fontSize: "13px", fontWeight: 600, color: statusColor }}>{statusLabel}</span>
        <span style={{ fontSize: "11px", color: "#9ca3af", marginLeft: "auto" }}>
          {new Date(record.createdAt).toLocaleTimeString()}
        </span>
      </div>

      {/* Transcript */}
      <p style={{ fontSize: "13px", color: "#e5e7eb", margin: "0 0 6px 0", fontStyle: "italic" }}>
        "{record.transcript}"
      </p>

      {/* Preview details */}
      {preview && (
        <div style={{ fontSize: "12px", color: "#d1d5db", marginBottom: "8px" }}>
          <strong style={{ color: "#f3f4f6" }}>{String(preview.title)}</strong>
          {preview.summary && (
            <p style={{ margin: "2px 0 0 0", color: "#9ca3af" }}>{String(preview.summary)}</p>
          )}
          {!!preview.targetUser && typeof preview.targetUser === "object" && (
            <div style={{ marginTop: "4px", display: "flex", gap: "6px", alignItems: "center" }}>
              <span style={{ color: "#6b7280" }}>→</span>
              <span style={{ color: "#a78bfa", fontWeight: 500 }}>
                {String((preview.targetUser as Record<string, unknown>).displayName ?? (preview.targetUser as Record<string, unknown>).email ?? "Remote user")}
              </span>
            </div>
          )}
          {preview.error && (
            <p style={{ color: "#f87171", marginTop: "4px", fontSize: "11px" }}>⚠ {String(preview.error)}</p>
          )}
        </div>
      )}

      {/* Relay / mission links */}
      {record.relayTaskId && (
        <div style={{ fontSize: "11px", color: "#6b7280", marginBottom: "6px" }}>
          Relay task: <code style={{ color: "#818cf8" }}>{shortId(record.relayTaskId)}</code>
        </div>
      )}
      {record.errorMessage && (
        <p style={{ fontSize: "11px", color: "#f87171", margin: "4px 0" }}>✗ {record.errorMessage}</p>
      )}

      {/* Action buttons */}
      {isActionable && (
        <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
          <button
            id={`voice-cmd-confirm-${record.id}`}
            onClick={() => void handleConfirm()}
            disabled={confirmMutation.isPending}
            style={primaryBtn}
          >
            {confirmMutation.isPending ? "Sending…" : (typeof preview?.actionLabel === "string" ? preview.actionLabel : "Confirm")}
          </button>
          <button
            id={`voice-cmd-cancel-${record.id}`}
            onClick={() => void handleCancel()}
            disabled={cancelMutation.isPending}
            style={secondaryBtn}
          >
            Cancel
          </button>
        </div>
      )}

      {/* Expand/collapse for debug info */}
      {!isTerminal && parsed && (
        <button
          onClick={() => setExpanded((e) => !e)}
          style={{ background: "none", border: "none", color: "#6b7280", fontSize: "11px", cursor: "pointer", padding: "4px 0 0 0" }}
        >
          {expanded ? "▲ Hide details" : "▼ Show details"}
        </button>
      )}
      {expanded && parsed && (
        <div style={{ marginTop: "6px", fontSize: "11px", color: "#6b7280", fontFamily: "monospace" }}>
          <div>intent: <span style={{ color: "#c084fc" }}>{String(parsed.intent)}</span></div>
          <div>confidence: <span style={{ color: "#34d399" }}>{((Number(parsed.confidence ?? 0)) * 100).toFixed(0)}%</span></div>
          <div>parser: <span style={{ color: "#60a5fa" }}>{record.parserProvider ?? "unknown"}</span></div>
        </div>
      )}
    </div>
  );
}

// ───────── Receiver Approval Card ─────────
// Shown on the RECEIVER's side when they have a pending file request.

export interface ReceiverApprovalPayload {
  approval_id: string;
  relay_task_id: string;
  file_query: string;
  requester_agent_instance_id: string;
  status: string;
  candidates: Array<{ id: string; name: string; path: string; score?: number }>;
  candidate_count: number;
  voice_command_id?: string;
}

export interface ReceiverApprovalCardProps {
  payload: ReceiverApprovalPayload;
  localAgentUrl?: string;
  onDecided?: () => void;
}

export function ReceiverApprovalCard({ payload, localAgentUrl = "http://127.0.0.1:3399", onDecided }: ReceiverApprovalCardProps) {
  const [selectedPath, setSelectedPath] = useState(payload.candidates[0]?.path ?? "");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<"approved" | "rejected" | null>(
    payload.status === "approved" ? "approved" : payload.status === "rejected" ? "rejected" : null
  );
  const [error, setError] = useState<string | null>(null);

  const isDecided = result !== null || (payload.status !== "pending" && payload.status !== "");

  async function handleApprove() {
    if (!selectedPath) { setError("Please select a file to send."); return; }
    setBusy(true);
    setError(null);
    try {
      const resp = await fetch(`${localAgentUrl}/receiver/approvals/${encodeURIComponent(payload.approval_id)}/approve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ selected_file_path: selectedPath })
      });
      if (!resp.ok) {
        const data = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
        throw new Error(typeof data.message === "string" ? data.message : "Approval failed");
      }
      setResult("approved");
      onDecided?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Approval failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleReject() {
    setBusy(true);
    setError(null);
    try {
      const resp = await fetch(`${localAgentUrl}/receiver/approvals/${encodeURIComponent(payload.approval_id)}/reject`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "Rejected by receiver" })
      });
      if (!resp.ok) throw new Error("Rejection failed");
      setResult("rejected");
      onDecided?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Rejection failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      id={`receiver-approval-${payload.approval_id}`}
      style={{
        border: "1px solid #7c3aed44",
        borderLeft: "3px solid #7c3aed",
        borderRadius: "10px",
        padding: "14px 16px",
        margin: "4px 0",
        background: "rgba(124,58,237,0.07)",
        maxWidth: "500px"
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
        <span style={{ fontSize: "18px" }}>📨</span>
        <span style={{ fontSize: "13px", fontWeight: 700, color: "#a78bfa" }}>
          Incoming File Request
        </span>
        {result && (
          <span style={{
            marginLeft: "auto",
            fontSize: "11px",
            color: result === "approved" ? "#10b981" : "#ef4444",
            fontWeight: 600
          }}>
            {result === "approved" ? "✓ Approved" : "✗ Rejected"}
          </span>
        )}
      </div>

      {/* Request details */}
      <div style={{ fontSize: "13px", color: "#d1d5db", marginBottom: "10px" }}>
        <strong style={{ color: "#f3f4f6" }}>Requested:</strong>{" "}
        <em>"{payload.file_query}"</em>
      </div>

      {/* File candidates */}
      {!isDecided && payload.candidates.length > 0 && (
        <div style={{ marginBottom: "10px" }}>
          <div style={{ fontSize: "11px", color: "#9ca3af", marginBottom: "4px" }}>
            Select file to send ({payload.candidates.length} candidate{payload.candidates.length !== 1 ? "s" : ""}):
          </div>
          {payload.candidates.map((c) => (
            <label
              key={c.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                padding: "6px 8px",
                borderRadius: "6px",
                cursor: "pointer",
                background: selectedPath === c.path ? "rgba(124,58,237,0.15)" : "transparent",
                border: selectedPath === c.path ? "1px solid #7c3aed66" : "1px solid transparent",
                marginBottom: "3px"
              }}
            >
              <input
                type="radio"
                name={`file-select-${payload.approval_id}`}
                value={c.path}
                checked={selectedPath === c.path}
                onChange={() => setSelectedPath(c.path)}
                style={{ accentColor: "#7c3aed" }}
              />
              <div>
                <div style={{ fontSize: "12px", color: "#e5e7eb", fontWeight: 500 }}>{c.name}</div>
                <div style={{ fontSize: "10px", color: "#6b7280", fontFamily: "monospace" }}>
                  {c.path.length > 50 ? `…${c.path.slice(-50)}` : c.path}
                </div>
              </div>
              {c.score !== undefined && (
                <span style={{ marginLeft: "auto", fontSize: "10px", color: "#8b5cf6" }}>
                  {(c.score * 100).toFixed(0)}%
                </span>
              )}
            </label>
          ))}
        </div>
      )}

      {!isDecided && payload.candidates.length === 0 && (
        <p style={{ fontSize: "12px", color: "#f59e0b", marginBottom: "10px" }}>
          ⚠ No matching files found automatically. You can manually provide a file path above.
        </p>
      )}

      {error && (
        <p style={{ fontSize: "11px", color: "#f87171", marginBottom: "8px" }}>✗ {error}</p>
      )}

      {/* Action buttons */}
      {!isDecided && (
        <div style={{ display: "flex", gap: "8px" }}>
          <button
            id={`receiver-approve-${payload.approval_id}`}
            onClick={() => void handleApprove()}
            disabled={busy || !selectedPath}
            style={primaryBtn}
          >
            {busy ? "Processing…" : "✓ Approve & Send"}
          </button>
          <button
            id={`receiver-reject-${payload.approval_id}`}
            onClick={() => void handleReject()}
            disabled={busy}
            style={secondaryBtn}
          >
            ✗ Reject
          </button>
        </div>
      )}

      {result === "approved" && (
        <p style={{ fontSize: "12px", color: "#10b981", margin: "4px 0 0 0" }}>
          ✓ File transfer initiated. The requester will be notified.
        </p>
      )}
      {result === "rejected" && (
        <p style={{ fontSize: "12px", color: "#9ca3af", margin: "4px 0 0 0" }}>
          Request rejected.
        </p>
      )}
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function MicIcon({ color }: { color: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/>
      <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
      <line x1="12" y1="19" x2="12" y2="22"/>
    </svg>
  );
}

function shortId(id: string): string {
  return id.length <= 14 ? id : `${id.slice(0, 6)}…${id.slice(-4)}`;
}

const primaryBtn: React.CSSProperties = {
  padding: "6px 14px",
  background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
  color: "#fff",
  border: "none",
  borderRadius: "6px",
  fontSize: "12px",
  fontWeight: 600,
  cursor: "pointer",
  transition: "opacity 0.15s"
};

const secondaryBtn: React.CSSProperties = {
  padding: "6px 14px",
  background: "transparent",
  color: "#9ca3af",
  border: "1px solid #374151",
  borderRadius: "6px",
  fontSize: "12px",
  cursor: "pointer",
  transition: "border-color 0.15s"
};
