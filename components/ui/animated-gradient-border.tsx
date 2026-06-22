import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

type AnimationMode = "auto-rotate" | "rotate-on-hover" | "stop-rotate-on-hover";

interface BorderRotateProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  animationMode?: AnimationMode;
  animationSpeed?: number;
  gradientColors?: {
    primary: string;
    secondary: string;
    accent: string;
  };
  borderWidth?: number;
  borderRadius?: number;
}

const defaultGradientColors = {
  primary: "#584827",
  secondary: "#c7a03c",
  accent: "#f9de90",
};

export function BorderRotate({
  children,
  className,
  animationMode = "auto-rotate",
  animationSpeed = 5,
  gradientColors = defaultGradientColors,
  borderWidth = 2,
  borderRadius = 30,
  style,
  ...props
}: BorderRotateProps) {
  const cssVars = {
    "--agb-primary": gradientColors.primary,
    "--agb-secondary": gradientColors.secondary,
    "--agb-accent": gradientColors.accent,
    "--agb-border-width": `${borderWidth}px`,
    "--agb-border-radius": `${borderRadius}px`,
    "--agb-animation-duration": `${animationSpeed}s`,
    ...style,
  } as CSSProperties;

  return (
    <div
      className={cn("animated-gradient-border", `animated-gradient-border--${animationMode}`, className)}
      style={cssVars}
      {...props}
    >
      <span className="animated-gradient-border__layer" aria-hidden="true" />
      <div className="animated-gradient-border__content">
        {children}
      </div>
    </div>
  );
}
