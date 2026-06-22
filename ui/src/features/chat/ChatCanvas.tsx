import type { ReactNode } from "react";
import { AlertTriangle, ListTodo, MessageSquareText, RefreshCw, Search } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { AmigoLogoLoader } from "../loading/AmigoLogoLoader";

interface ChatCanvasProps {
  header?: ReactNode;
  timeline?: ReactNode;
  composer?: ReactNode;
  inspector?: ReactNode;
  emptyState?: ReactNode;
  loadingState?: ReactNode;
  errorState?: ReactNode;
}

export function ChatCanvas({
  header,
  timeline,
  composer,
  inspector,
  emptyState,
  loadingState,
  errorState,
}: ChatCanvasProps) {
  const mainContent = errorState ?? loadingState ?? timeline ?? emptyState;

  return (
    <section className="oa-discord-chat-canvas" data-testid="discord-chat-canvas" aria-label="Agentic chat canvas">
      <div className="oa-discord-chat-main">
        {header}
        <div className="oa-discord-chat-body">
          <div className="oa-discord-chat-stage">
            {mainContent}
            {composer}
          </div>
          {inspector}
        </div>
      </div>
    </section>
  );
}

interface ChatCanvasEmptyStateProps {
  title?: string;
  subtitle?: string;
  onSearchDirectory: () => void;
  onOpenLocalAgent: () => void;
  onOpenApprovals: () => void;
}

export function ChatCanvasEmptyState({
  title = "Oracle Amigo",
  subtitle = "This is the beginning of your agentic chat canvas.",
  onSearchDirectory,
  onOpenLocalAgent,
  onOpenApprovals,
}: ChatCanvasEmptyStateProps) {
  return (
    <div className="oa-discord-empty" data-testid="chat-canvas-empty">
      <div className="oa-discord-empty-inner">
        <Avatar className="oa-discord-empty-avatar" size="lg">
          <AvatarFallback>OA</AvatarFallback>
        </Avatar>
        <div className="oa-discord-empty-copy">
          <h1>{title}</h1>
          <p>{subtitle}</p>
        </div>
        <Separator className="oa-discord-empty-separator" />
        <div className="oa-discord-empty-actions" aria-label="Chat start actions">
          <Button type="button" variant="secondary" onClick={onSearchDirectory}>
            <Search data-icon="inline-start" />
            Search directory
          </Button>
          <Button type="button" variant="outline" onClick={onOpenLocalAgent}>
            <MessageSquareText data-icon="inline-start" />
            Open local agent
          </Button>
          <Button type="button" variant="ghost" onClick={onOpenApprovals}>
            <ListTodo data-icon="inline-start" />
            Review approvals
          </Button>
        </div>
      </div>
    </div>
  );
}

export function ChatCanvasLoadingState() {
  return (
    <div className="oa-discord-status" data-testid="chat-canvas-loading" role="status" aria-live="polite">
      <AmigoLogoLoader label="Loading conversation..." status={false} />
    </div>
  );
}

interface ChatCanvasErrorStateProps {
  title: string;
  message: string;
  refreshing?: boolean;
  retryLabel?: string;
  onRetry: () => void;
  onOpenLocalAgent?: () => void;
}

export function ChatCanvasErrorState({
  title,
  message,
  refreshing,
  retryLabel = "Retry",
  onRetry,
  onOpenLocalAgent,
}: ChatCanvasErrorStateProps) {
  return (
    <div className="oa-discord-status" data-testid="chat-canvas-error" role="alert">
      <div className="oa-discord-status-card oa-discord-error-card">
        <div className="oa-discord-error-icon" aria-hidden="true">
          <AlertTriangle />
        </div>
        <div className="oa-discord-status-copy">
          <h2>{title}</h2>
          <p>{message}</p>
        </div>
        <div className="oa-discord-error-actions">
          <Button type="button" onClick={onRetry} disabled={refreshing}>
            <RefreshCw data-icon="inline-start" className={refreshing ? "animate-spin" : undefined} />
            {refreshing ? "Refreshing session" : retryLabel}
          </Button>
          {onOpenLocalAgent && (
            <Button type="button" variant="outline" onClick={onOpenLocalAgent}>
              Open local agent
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
