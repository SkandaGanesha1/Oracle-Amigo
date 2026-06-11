import { heroui } from "@heroui/theme/plugin";

/** @type {import('tailwindcss').Config} */
export default {
  content: [],
  plugins: [
    heroui({
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
            background: "#070A0F",
            foreground: "#F8FAFC",
            primary: {
              DEFAULT: "#3B82F6",
              foreground: "#ffffff",
            },
            secondary: {
              DEFAULT: "#151C27",
              foreground: "#F8FAFC",
            },
            success: {
              DEFAULT: "#22C55E",
              foreground: "#ffffff",
            },
            warning: {
              DEFAULT: "#F59E0B",
              foreground: "#000000",
            },
            danger: {
              DEFAULT: "#EF4444",
              foreground: "#ffffff",
            },
            focus: "#8ec5ff",
            divider: "rgba(148, 163, 184, 0.14)",
            content1: "#111827",
            content2: "#151C27",
            content3: "#1B2533",
            content4: "#1F2937",
            default: {
              DEFAULT: "#151C27",
              foreground: "#F8FAFC",
            },
          },
        },
      },
    }),
  ],
};
