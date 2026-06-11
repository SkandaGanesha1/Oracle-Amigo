import { type ComponentProps, createContext, type ReactNode, useContext } from "react";
import { Alert, AlertDescription } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import { Send, FileText } from "lucide-react";

interface SendConfirmationValue {
  text: string;
  sendAs: "normal" | "file_request";
  pending: boolean;
}

const SendConfirmationContext = createContext<SendConfirmationValue | null>(null);

const useSendConfirmation = () => {
  const ctx = useContext(SendConfirmationContext);
  if (!ctx) throw new Error("SendConfirmation sub-components must be used within SendConfirmation");
  return ctx;
};

export type SendConfirmationProps = ComponentProps<typeof Alert> & {
  text: string;
  sendAs: "normal" | "file_request";
  pending: boolean;
};

export function SendConfirmation({ className, text, sendAs, pending, ...props }: SendConfirmationProps) {
  return (
    <SendConfirmationContext.Provider value={{ text, sendAs, pending }}>
      <Alert className={cn("flex flex-col gap-3 !bg-oa-surface !border-oa-border", className)} {...props} />
    </SendConfirmationContext.Provider>
  );
}

export type SendConfirmationTitleProps = ComponentProps<typeof AlertDescription>;

export function SendConfirmationTitle({ className, ...props }: SendConfirmationTitleProps) {
  return <AlertDescription className={cn("inline text-oa-text", className)} {...props} />;
}

export function SendConfirmationMessage() {
  const { text, sendAs } = useSendConfirmation();
  return (
    <div className="flex items-start gap-2 text-sm">
      {sendAs === "file_request" ? (
        <FileText className="mt-0.5 h-4 w-4 shrink-0 text-oa-amber" />
      ) : (
        <Send className="mt-0.5 h-4 w-4 shrink-0 text-oa-blue" />
      )}
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-oa-text-muted">
          {sendAs === "file_request" ? "Send file request?" : "Send message?"}
        </span>
        <p className="text-xs text-oa-text leading-relaxed">{text}</p>
      </div>
    </div>
  );
}

export type SendConfirmationActionsProps = ComponentProps<"div">;

export function SendConfirmationActions({ className, ...props }: SendConfirmationActionsProps) {
  return <div className={cn("flex items-center justify-end gap-2 self-end", className)} {...props} />;
}

type SendConfirmationActionProps = ComponentProps<typeof Button> & {
  variant?: "default" | "outline" | "ghost";
};

export function SendConfirmationApprove(props: SendConfirmationActionProps) {
  const { pending } = useSendConfirmation();
  return (
    <Button
      className="h-8 px-3 text-xs"
      type="button"
      variant="default"
      disabled={pending}
      {...props}
    >
      {pending ? "Sending..." : "Approve"}
    </Button>
  );
}

export function SendConfirmationReject(props: SendConfirmationActionProps) {
  return (
    <Button
      className="h-8 px-3 text-xs"
      type="button"
      variant="outline"
      {...props}
    >
      Cancel
    </Button>
  );
}
