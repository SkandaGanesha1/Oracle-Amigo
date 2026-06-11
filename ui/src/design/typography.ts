export const fontFamily = {
  sans: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif",
  mono: "ui-monospace, SFMono-Regular, Consolas, 'Liberation Mono', monospace",
} as const;

export const fontSize = {
  xs: "0.75rem",
  sm: "0.8125rem",
  base: "0.875rem",
  message: "0.9375rem",
  lg: "1rem",
  xl: "1.125rem",
  "2xl": "1.25rem",
  "3xl": "1.5rem",
} as const;

export const fontWeight = {
  normal: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
} as const;

export const lineHeight = {
  tight: "1.2",
  normal: "1.5",
  relaxed: "1.625",
  loose: "2",
} as const;

export const letterSpacing = {
  tighter: "-0.02em",
  normal: "0",
  wide: "0.02em",
  wider: "0.05em",
  widest: "0.1em",
} as const;
