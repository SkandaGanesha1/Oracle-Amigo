export type StatusSeverity = "success" | "info" | "warning" | "danger" | "neutral";

export interface StatusColorConfig {
  bg: string;
  text: string;
  border: string;
  dot: string;
  severity: StatusSeverity;
}

export const statusColors: Record<string, StatusColorConfig> = {
  online: {
    bg: "rgba(34, 197, 94, 0.1)",
    text: "#22C55E",
    border: "rgba(34, 197, 94, 0.2)",
    dot: "#22C55E",
    severity: "success",
  },
  offline: {
    bg: "rgba(71, 85, 105, 0.1)",
    text: "#475569",
    border: "rgba(71, 85, 105, 0.2)",
    dot: "#475569",
    severity: "neutral",
  },
  stale: {
    bg: "rgba(245, 158, 11, 0.1)",
    text: "#F59E0B",
    border: "rgba(245, 158, 11, 0.2)",
    dot: "#F59E0B",
    severity: "warning",
  },
  heartbeat: {
    bg: "rgba(34, 211, 238, 0.1)",
    text: "#22D3EE",
    border: "rgba(34, 211, 238, 0.2)",
    dot: "#22D3EE",
    severity: "info",
  },
  relay: {
    bg: "rgba(59, 130, 246, 0.1)",
    text: "#3B82F6",
    border: "rgba(59, 130, 246, 0.2)",
    dot: "#3B82F6",
    severity: "info",
  },
  error: {
    bg: "rgba(239, 68, 68, 0.1)",
    text: "#EF4444",
    border: "rgba(239, 68, 68, 0.2)",
    dot: "#EF4444",
    severity: "danger",
  },
  pending: {
    bg: "rgba(245, 158, 11, 0.1)",
    text: "#F59E0B",
    border: "rgba(245, 158, 11, 0.2)",
    dot: "#F59E0B",
    severity: "warning",
  },
  verified: {
    bg: "rgba(34, 197, 94, 0.1)",
    text: "#22C55E",
    border: "rgba(34, 197, 94, 0.2)",
    dot: "#22C55E",
    severity: "success",
  },
  local: {
    bg: "rgba(100, 116, 139, 0.1)",
    text: "#64748B",
    border: "rgba(100, 116, 139, 0.2)",
    dot: "#64748B",
    severity: "neutral",
  },
};
