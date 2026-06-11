import { Button, Spinner, type ButtonProps } from "@heroui/react";
import { cn } from "~/lib/utils";
import type { ButtonVariants } from "@heroui/styles";

type OAButtonVariant = "primary" | "secondary" | "danger" | "ghost" | "approve" | "reject";

interface OracleButtonProps extends Omit<ButtonProps, "variant"> {
  oaVariant?: OAButtonVariant;
  isPending?: boolean;
}

const variantMap: Record<OAButtonVariant, ButtonVariants["variant"]> = {
  primary: "primary",
  secondary: "secondary",
  danger: "danger",
  ghost: "ghost",
  approve: "primary",
  reject: "danger",
};

export function OracleButton({ oaVariant = "primary", isPending, className, children, ...props }: OracleButtonProps) {
  return (
    <Button
      variant={variantMap[oaVariant]}
      className={cn("rounded-lg font-medium", className)}
      isDisabled={isPending || props.isDisabled}
      {...props}
    >
      {isPending ? <Spinner size="sm" /> : children}
    </Button>
  );
}
