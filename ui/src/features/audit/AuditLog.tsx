import { useEffect, useMemo, useRef, useState } from "react";
import { useAuditEvents, useAuditVerify } from "../../hooks/queries";
import { ScrollText, Search, X, ChevronDown, ChevronRight, ShieldCheck, Download, Filter, Calendar, Copy, Check, RefreshCw, User, FileText, Ban, CheckCircle, XCircle, Clock, ArrowRight, Globe, Lock, Unlock, Settings, LogIn, LogOut } from "lucide-react";
import type { AuditEvent } from "../../api/types";
import { detectFileSensitivity, SENSITIVITY_CONFIG } from "../../types";

function humanReadableDescription(event: AuditEvent): string {
  const agent = event.actorAgentId?.slice(0, 12) ?? "Unknown agent";
  const agentFull = event.actorAgentId ?? "unknown";
  const taskRef = event.taskId ? ` for task ${event.taskId.slice(0, 8)}...` : "";
  const ts = new Date(event.createdAt).toLocaleString();

  const details = event.detailsJson as Record<string, string | undefined>;
  const fileName = details?.file_name ?? details?.fileName ?? "";

  switch (event.eventType) {
    case "approval_created":
      return fileName
        ? `${agent} requested access to ${fileName}${taskRef}`
        : `${agent} requested file access${taskRef}`;
    case "approval_approved":
      return fileName
        ? `Approval granted — You allowed transfer of ${fileName} to ${agent}${taskRef}`
        : `Approval granted — ${agent} allowed transfer${taskRef}`;
    case "approval_rejected":
      return fileName
        ? `Approval denied — You rejected transfer of ${fileName} to ${agent}${taskRef}`
        : `Approval denied — ${agent} rejected transfer${taskRef}`;
    case "approval_expired":
      return fileName
        ? `Request expired — You did not respond to request for ${fileName} in time${taskRef}`
        : `Request expired — ${agent} did not respond in time${taskRef}`;
    case "file_received":
      return fileName
        ? `File received: ${fileName} from ${agent}${taskRef}`
        : `File received from ${agent}${taskRef}`;
    case "file_transferred":
      return fileName
        ? `File sent: ${fileName} to ${agent}${taskRef}`
        : `File sent to ${agent}${taskRef}`;
    case "file_verified":
      return fileName
        ? `File integrity verified for ${fileName}${taskRef}`
        : `File integrity verified for transfer${taskRef}`;
    case "file_revoked":
      return fileName
        ? `${agent} revoked access to ${fileName}${taskRef}`
        : `${agent} revoked access to a previously shared file${taskRef}`;
    case "contact_requested":
      return `${agent} sent a contact request`;
    case "contact_accepted":
      return `${agent} accepted your contact request`;
    case "agent_run_started":
      return `${agent} started a task${taskRef}`;
    case "agent_run_completed":
      return `${agent} completed a task${taskRef}`;
    case "agent_run_failed":
      return `${agent} encountered an error while running a task${taskRef}`;
    case "session_created":
      return `Session started with ${agent}`;
    case "session_closed":
      return `Session ended with ${agent}`;
    case "config_changed":
      return `Configuration changed by ${agent}`;
    case "login":
      return `${agent} logged in`;
    case "logout":
      return `${agent} logged out`;
    default: {
      const pretty = event.eventType.replace(/_/g, " ");
      const detailStr = details?.file_name ?? details?.fileName ?? "";
      return detailStr ? `${agent} ${pretty}: ${detailStr}` : `${agent} ${pretty}`;
    }
  }
}

const severityConfig: Record<string, { color: string; bg: string; icon: typeof ShieldCheck }> = {
  info: { color: "text-oa-blue", bg: "bg-oa-blue/10", icon: Clock },
  warning: { color: "text-oa-amber", bg: "bg-oa-amber/10", icon: Ban },
  error: { color: "text-oa-red", bg: "bg-oa-red/10", icon: XCircle },
  success: { color: "text-oa-green", bg: "bg-oa-green/10", icon: CheckCircle },
};

function getEventSeverity(type: string): string {
  if (type.includes("failed") || type.includes("error") || type.includes("revoked")) return "error";
  if (type.includes("expired") || type.includes("warning")) return "warning";
  if (type.includes("completed") || type.includes("approved") || type.includes("verified") || type.includes("accepted") || type.includes("received")) return "success";
  return "info";
}

interface AuditLogProps {
  compact?: boolean;
}

export function AuditLog({ compact = false }: AuditLogProps) {
  const { data, isLoading } = useAuditEvents();
  const verifyQuery = useAuditVerify();
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [typeFilter, setTypeFilter] = useState("all");
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const copyTimerRef = useRef<number | null>(null);

  const events = data?.events ?? [];
  const chainValid = data?.chainValid?.valid;

  const eventTypes = useMemo(() => {
    const types = new Set(events.map((e) => e.eventType));
    return Array.from(types).sort();
  }, [events]);

  const filtered = useMemo(() => {
    return events.filter((e) => {
      const desc = humanReadableDescription(e).toLowerCase();
      if (search && !desc.includes(search.toLowerCase())) return false;
      if (typeFilter !== "all" && e.eventType !== typeFilter) return false;
      return true;
    });
  }, [events, search, typeFilter]);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  const handleExport = () => {
    const json = JSON.stringify(events, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit-events-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopyHash = async (hash: string, id: number) => {
    await navigator.clipboard.writeText(hash);
    setCopiedId(id);
    if (copyTimerRef.current !== null) {
      window.clearTimeout(copyTimerRef.current);
    }
    copyTimerRef.current = window.setTimeout(() => {
      copyTimerRef.current = null;
      setCopiedId(null);
    }, 2000);
  };

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="flex flex-col items-center gap-2">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-oa-blue border-t-transparent" />
          <p className="text-xs text-oa-text-muted">Loading audit log...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-4 p-6 max-w-5xl">
      {!compact && (
        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-1">
            <h1 className="text-lg font-semibold text-oa-text">Activity Log</h1>
            <p className="text-sm text-oa-text-muted">
              {events.length} event{events.length !== 1 ? "s" : ""}
              {chainValid !== undefined && (
                <span className={`ml-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${chainValid ? "text-oa-green bg-oa-green/10" : "text-oa-red bg-oa-red/10"}`}>
                  <ShieldCheck className="h-3 w-3" />
                  Chain {chainValid ? "valid" : "broken"}
                </span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void verifyQuery.refetch()}
              className="flex min-h-[48px] items-center gap-2 rounded-lg border border-oa-border bg-oa-surface px-3 py-2 text-xs text-oa-text-muted hover:bg-oa-surface-2 hover:text-oa-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue focus-visible:ring-offset-2"
            >
              <RefreshCw className={`h-4 w-4 ${verifyQuery.isFetching ? "animate-spin" : ""}`} />
              Verify chain
            </button>
            <button
              type="button"
              onClick={handleExport}
              className="flex min-h-[48px] items-center gap-2 rounded-lg border border-oa-border bg-oa-surface px-3 py-2 text-xs text-oa-text-muted hover:bg-oa-surface-2 hover:text-oa-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue focus-visible:ring-offset-2"
            >
              <Download className="h-4 w-4" />
              Export JSON
            </button>
          </div>
        </div>
      )}

      {verifyQuery.data && !compact && (
        <div className={`rounded-lg border px-3 py-2 text-xs ${verifyQuery.data.valid ? "border-oa-green/30 bg-oa-green/10 text-oa-green" : "border-oa-red/30 bg-oa-red/10 text-oa-red"}`}>
          Chain verification: {verifyQuery.data.valid ? "valid — all events are tamper-evident" : verifyQuery.data.reason ?? "failed"}
        </div>
      )}

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-oa-text-muted" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search activity descriptions..."
            className="h-10 w-full rounded-lg border border-oa-border bg-oa-surface pl-10 pr-3 text-sm text-oa-text outline-none transition focus:border-oa-blue placeholder:text-oa-text-disabled"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 flex min-h-[48px] min-w-[48px] items-center justify-center text-oa-text-muted hover:text-oa-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Filter className="h-3.5 w-3.5 text-oa-text-muted" />
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="h-9 rounded-lg border border-oa-border bg-oa-surface px-2.5 text-[10px] text-oa-text outline-none focus:border-oa-blue"
            aria-label="Filter by event type"
          >
            <option value="all">All activity</option>
            {eventTypes.map((type) => (
              <option key={type} value={type}>{type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}</option>
            ))}
          </select>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="flex flex-col items-center gap-3 text-center max-w-sm">
            <ScrollText className="h-10 w-10 text-oa-text-muted" />
            <div>
              <p className="text-sm font-medium text-oa-text-muted">
                {search || typeFilter !== "all" ? "No events match your filters" : "No activity recorded yet"}
              </p>
              <p className="text-xs text-oa-text-disabled mt-1">
                {search || typeFilter !== "all" ? "Try adjusting your search or filters" : "Audit events will appear here as agent activity is recorded"}
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          {filtered.map((event) => {
            const severity = getEventSeverity(event.eventType);
            const sev = severityConfig[severity] ?? severityConfig.info;
            const SevIcon = sev.icon;
            const isExpanded = expandedId === event.id;
            const desc = humanReadableDescription(event);

            const fileMatch = event.detailsJson?.file_name as string | undefined ?? "";
            const sens = fileMatch ? detectFileSensitivity(fileMatch) : null;

            return (
              <div key={event.id} className="rounded-xl card-audit-event border overflow-hidden transition hover:border-oa-border-strong" role="region" aria-label={`Audit event: ${desc}`}>
                <button
                  type="button"
                  onClick={() => setExpandedId(isExpanded ? null : event.id)}
                  aria-expanded={isExpanded}
                  className="flex w-full items-center gap-3 p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-oa-blue"
                >
                  <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${sev.bg}`}>
                    <SevIcon className={`card-icon h-4 w-4 ${sev.color}`} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-oa-text">{desc}</span>
                      {sens && (
                        <span className={`shrink-0 rounded px-1 py-0.5 text-[8px] font-medium ${SENSITIVITY_CONFIG[sens.level].color} ${SENSITIVITY_CONFIG[sens.level].bg}`}>
                          {sens.label}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <Calendar className="h-3 w-3 text-oa-text-disabled" />
                      <span className="text-[10px] text-oa-text-disabled">{new Date(event.createdAt).toLocaleString()}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`rounded px-1.5 py-0.5 text-[9px] font-medium ${sev.color} ${sev.bg}`}>
                      {severity}
                    </span>
                    {isExpanded ? <ChevronDown className="h-4 w-4 text-oa-text-muted" /> : <ChevronRight className="h-4 w-4 text-oa-text-muted" />}
                  </div>
                </button>

                {isExpanded && (
                  <div className="border-t border-oa-border">
                    <div className="space-y-2 p-3">
                      <div className="grid grid-cols-[100px_1fr] gap-1 text-[10px]">
                        <span className="text-oa-text-muted">Event</span>
                        <span className="text-oa-text">{event.eventType.replace(/_/g, " ")}</span>
                        <span className="text-oa-text-muted">Agent</span>
                        <span className="text-oa-text font-mono">{event.actorAgentId}</span>
                        <span className="text-oa-text-muted">When</span>
                        <span className="text-oa-text">{new Date(event.createdAt).toLocaleString()}</span>
                        {event.taskId && (
                          <>
                            <span className="text-oa-text-muted">Task</span>
                            <span className="text-oa-text font-mono text-[9px]">{event.taskId}</span>
                          </>
                        )}
                      </div>

                      {fileMatch && (
                        <div className="rounded-lg bg-oa-bg-elevated p-2 text-[10px]">
                          <span className="text-oa-text-muted">File: </span>
                          <span className="text-oa-text font-medium">{fileMatch}</span>
                        </div>
                      )}

                      {Object.keys(event.detailsJson).length > 0 && (
                        <div className="rounded-lg bg-oa-bg-elevated p-2">
                          <pre className="overflow-auto whitespace-pre-wrap break-words text-[10px] font-mono text-oa-text-secondary max-h-48">
                            {JSON.stringify(event.detailsJson, null, 2)}
                          </pre>
                        </div>
                      )}

                      <div className="flex items-center gap-2 border-t border-oa-border/50 pt-2">
                        <button
                          type="button"
                          onClick={() => handleCopyHash(event.eventHash, event.id)}
                          className="flex min-h-[48px] items-center gap-1 text-[9px] text-oa-text-muted hover:text-oa-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue"
                        >
                          {copiedId === event.id ? (
                            <><Check className="h-3 w-3 text-oa-green" /> Hash copied</>
                          ) : (
                            <><Copy className="h-3 w-3" /> Copy event hash</>
                          )}
                        </button>
                        <span className="font-mono text-[8px] text-oa-text-disabled truncate max-w-[200px]" title={event.eventHash}>
                          {event.eventHash}
                        </span>
                        {chainValid !== undefined && (
                          <span className={`ml-auto flex items-center gap-1 text-[9px] ${chainValid ? "text-oa-green" : "text-oa-red"}`}>
                            <ShieldCheck className="h-3 w-3" />
                            {chainValid ? "Tamper-evident chain verified" : "Chain integrity check failed"}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
