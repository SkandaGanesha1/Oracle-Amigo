export interface SurfaceElevationEntry {
  bg: string;
  border: string;
  shadow?: string;
}

export const surfaceElevation: Record<string, SurfaceElevationEntry> = {
  flat: {
    bg: "var(--oa-bg)",
    border: "var(--oa-border)",
  },
  raised: {
    bg: "var(--oa-surface)",
    border: "var(--oa-border)",
    shadow: "0 1px 2px rgba(0,0,0,0.3)",
  },
  elevated: {
    bg: "var(--oa-surface-2)",
    border: "var(--oa-border-strong)",
    shadow: "0 4px 12px rgba(0,0,0,0.35)",
  },
  overlay: {
    bg: "var(--oa-surface-3)",
    border: "var(--oa-border-strong)",
    shadow: "0 8px 24px rgba(0,0,0,0.4)",
  },
  modal: {
    bg: "var(--oa-surface-2)",
    border: "var(--oa-border-strong)",
    shadow: "0 16px 48px rgba(0,0,0,0.5)",
  },
};

export const surfaceRoles = {
  commandBar: "var(--oa-surface)",
  sidebar: "var(--oa-sidebar-bg)",
  chat: "var(--oa-chat-bg)",
  bubble: "var(--oa-bubble-bg)",
  composer: "var(--oa-surface)",
  inspector: "var(--oa-sidebar-bg)",
  card: "var(--oa-surface)",
  dropdown: "var(--oa-surface-2)",
  tooltip: "var(--oa-surface-3)",
  modal: "var(--oa-surface-2)",
} as const;

export type SurfaceStyle = {
  bg: string;
  border: string;
  shadow?: string;
};

export function getSurface(elevation: keyof typeof surfaceElevation): SurfaceStyle {
  return surfaceElevation[elevation];
}
