export const colors = {
  bg: "#070A0F",
  bgElevated: "#0D1117",
  surface: "#111827",
  surface2: "#151C27",
  surface3: "#1B2533",
  text: "#F8FAFC",
  textSecondary: "#CBD5E1",
  textMuted: "#94A3B8",
  textDisabled: "#64748B",
  border: "rgba(148, 163, 184, 0.14)",
  borderStrong: "rgba(148, 163, 184, 0.24)",
  blue: "#3B82F6",
  cyan: "#22D3EE",
  purple: "#A855F7",
  green: "#22C55E",
  amber: "#F59E0B",
  red: "#EF4444",
  pink: "#EC4899",
  chatBg: "#000000",
  sidebarBg: "#1A1A2E",
  bubbleBg: "#1E1E2E",
} as const;

export const semanticColors = {
  online: colors.green,
  heartbeat: colors.cyan,
  relay: colors.blue,
  approval: colors.amber,
  transfer: colors.purple,
  danger: colors.red,
  verified: colors.green,
  localOnly: "#64748B",
  offline: "#475569",
} as const;

export const typography = {
  fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif",
  fontMono: "ui-monospace, SFMono-Regular, Consolas, 'Liberation Mono', monospace",
  sizes: {
    xs: "0.75rem",
    sm: "0.8125rem",
    base: "0.875rem",
    message: "0.9375rem",
    lg: "1rem",
    xl: "1.125rem",
    "2xl": "1.25rem",
    "3xl": "1.5rem",
  },
  weights: {
    normal: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
  },
} as const;

export const spacing = {
  px: "1px",
  0.5: "2px",
  1: "4px",
  1.5: "6px",
  2: "8px",
  2.5: "10px",
  3: "12px",
  3.5: "14px",
  4: "16px",
  5: "20px",
  6: "24px",
  7: "28px",
  8: "32px",
  10: "40px",
  12: "48px",
} as const;

export const radius = {
  sm: "6px",
  md: "8px",
  lg: "10px",
  xl: "14px",
  "2xl": "18px",
  full: "9999px",
} as const;

export const shadows = {
  sm: "0 1px 2px rgba(0,0,0,0.3)",
  md: "0 4px 12px rgba(0,0,0,0.35)",
  lg: "0 8px 24px rgba(0,0,0,0.4)",
  glow: {
    blue: "0 0 20px rgba(59, 130, 246, 0.15)",
    green: "0 0 20px rgba(34, 197, 94, 0.15)",
    amber: "0 0 20px rgba(245, 158, 11, 0.15)",
    purple: "0 0 20px rgba(168, 85, 247, 0.15)",
  },
} as const;

export const motion = {
  fast: "120ms",
  normal: "180ms",
  slow: "240ms",
  ease: "ease",
} as const;

// Light mode colors
export const colorsLight = {
  bg: "#FAFAFA",
  bgElevated: "#FFFFFF",
  surface: "#FFFFFF",
  surface2: "#F9FAFB",
  surface3: "#F3F4F6",
  text: "#1A1A1A",
  textSecondary: "#374151",
  textMuted: "#6B7280",
  textDisabled: "#9CA3AF",
  border: "rgba(0, 0, 0, 0.12)",
  borderStrong: "rgba(0, 0, 0, 0.24)",
  blue: "#2563EB",
  cyan: "#0891B2",
  purple: "#7C3AED",
  green: "#059669",
  amber: "#D97706",
  red: "#DC2626",
  pink: "#DB2777",
  chatBg: "#FAFAFA",
  sidebarBg: "#FFFFFF",
  bubbleBg: "#F9FAFB",
} as const;

// High contrast mode colors
export const colorsHighContrast = {
  bg: "#000000",
  bgElevated: "#0A0A0A",
  surface: "#0A0A0A",
  surface2: "#141414",
  surface3: "#1F1F1F",
  text: "#FFFFFF",
  textSecondary: "#E5E5E5",
  textMuted: "#B3B3B3",
  textDisabled: "#808080",
  border: "#FFFFFF",
  borderStrong: "#FFFFFF",
  blue: "#60A5FA",
  cyan: "#22D3EE",
  purple: "#A78BFA",
  green: "#34D399",
  amber: "#FBBF24",
  red: "#F87171",
  pink: "#F472B6",
  chatBg: "#000000",
  sidebarBg: "#000000",
  bubbleBg: "#0A0A0A",
} as const;

export const cardVariants = {
  // Human chat: Chat bubble with avatar, soft colors
  "human-chat": {
    borderColor: "rgba(59, 130, 246, 0.24)",
    backgroundColor: "rgba(59, 130, 246, 0.08)",
    iconColor: "#3B82F6",
    borderWidth: "1px",
  },
  // Agent progress: Expanded view, step indicators, time estimates
  "agent-progress": {
    borderColor: "rgba(34, 211, 238, 0.24)",
    backgroundColor: "rgba(34, 211, 238, 0.05)",
    iconColor: "#22D3EE",
    borderWidth: "2px",
  },
  // Approval request: Shield icon, prominent CTA buttons, risk header
  "approval-request": {
    borderColor: "rgba(245, 158, 11, 0.24)",
    backgroundColor: "rgba(245, 158, 11, 0.08)",
    iconColor: "#F59E0B",
    borderWidth: "2px",
  },
  // File candidate: File icon, match score, metadata
  "file-candidate": {
    borderColor: "rgba(148, 163, 184, 0.16)",
    backgroundColor: "rgba(15, 23, 42, 0.72)",
    iconColor: "#94A3B8",
    borderWidth: "1px",
  },
  // Transfer result: Checkmark/shield, hash verification, success/warning states
  "transfer-result": {
    borderColor: "rgba(34, 197, 94, 0.24)",
    backgroundColor: "rgba(34, 197, 94, 0.08)",
    iconColor: "#22C55E",
    borderWidth: "1px",
  },
  // Warning: Amber/red border, warning icon, high-contrast text
  "warning": {
    borderColor: "rgba(239, 68, 68, 0.32)",
    backgroundColor: "rgba(239, 68, 68, 0.12)",
    iconColor: "#EF4444",
    borderWidth: "2px",
  },
  // Audit event: Timeline style, timestamp, event type badge
  "audit-event": {
    borderColor: "rgba(168, 85, 247, 0.24)",
    backgroundColor: "rgba(168, 85, 247, 0.05)",
    iconColor: "#A855F7",
    borderWidth: "1px",
  },
  // Transfer progress: Progress bar, percentage, status
  "transfer-progress": {
    borderColor: "rgba(59, 130, 246, 0.24)",
    backgroundColor: "rgba(59, 130, 246, 0.05)",
    iconColor: "#3B82F6",
    borderWidth: "1px",
  },
} as const;
