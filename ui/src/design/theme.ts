import { colors, semanticColors, typography, radius, shadows } from "./tokens";

export const themeConfig = {
  heroui: {
    defaultTheme: "dark",
    defaultExtendTheme: "dark",
    layout: {
      radius: {
        small: "6px",
        medium: "8px",
        large: "10px",
      },
      borderWidth: {
        small: "1px",
        medium: "1px",
        large: "2px",
      },
    },
    themes: {
      dark: {
        colors: {
          background: colors.bg,
          foreground: colors.text,
          primary: {
            DEFAULT: colors.blue,
            foreground: "#ffffff",
          },
          secondary: {
            DEFAULT: colors.surface2,
            foreground: colors.text,
          },
          success: {
            DEFAULT: colors.green,
            foreground: "#ffffff",
          },
          warning: {
            DEFAULT: colors.amber,
            foreground: "#000000",
          },
          danger: {
            DEFAULT: colors.red,
            foreground: "#ffffff",
          },
          focus: "#8ec5ff",
          divider: colors.border,
          content1: colors.surface,
          content2: colors.surface2,
          content3: colors.surface3,
          content4: "#1F2937",
          default: {
            DEFAULT: colors.surface2,
            foreground: colors.text,
          },
        },
      },
    },
  },
} as const;

export const appTheme = {
  css: `
    :root {
      color-scheme: dark;
      --oa-bg: ${colors.bg};
      --oa-bg-elevated: ${colors.bgElevated};
      --oa-surface: ${colors.surface};
      --oa-surface-2: ${colors.surface2};
      --oa-surface-3: ${colors.surface3};
      --oa-text: ${colors.text};
      --oa-text-secondary: ${colors.textSecondary};
      --oa-text-muted: ${colors.textMuted};
      --oa-text-disabled: ${colors.textDisabled};
      --oa-border: ${colors.border};
      --oa-border-strong: ${colors.borderStrong};
      --oa-blue: ${colors.blue};
      --oa-cyan: ${colors.cyan};
      --oa-purple: ${colors.purple};
      --oa-green: ${colors.green};
      --oa-amber: ${colors.amber};
      --oa-red: ${colors.red};
      --oa-pink: ${colors.pink};
      --oa-font-sans: ${typography.fontFamily};
      --oa-font-mono: ${typography.fontMono};
      --oa-radius-lg: ${radius.lg};
      --oa-radius-xl: ${radius.xl};
      --oa-radius-2xl: ${radius["2xl"]};
      --oa-shadow-sm: ${shadows.sm};
      --oa-shadow-md: ${shadows.md};
      --oa-shadow-lg: ${shadows.lg};
      --oa-chat-bg: ${colors.chatBg};
      --oa-sidebar-bg: ${colors.sidebarBg};
      --oa-bubble-bg: ${colors.bubbleBg};
    }
  `,
};
