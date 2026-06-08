import { Component, createContext, useCallback, useContext, useMemo, useState, type ErrorInfo, type ReactNode } from "react";
import { Paperclip } from "lucide-react";

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("UI error boundary caught an error", error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.error) {
      return <EmptyState title="UI error" text={this.state.error.message} />;
    }
    return this.props.children;
  }
}

interface Toast {
  id: string;
  text: string;
  tone: "info" | "success" | "warning" | "error";
}

const ToastContext = createContext<{ pushToast: (toast: Omit<Toast, "id">) => void }>({ pushToast: () => undefined });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const pushToast = useCallback((toast: Omit<Toast, "id">) => {
    const id = crypto.randomUUID();
    setToasts((current) => [...current, { ...toast, id }]);
    window.setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), 4500);
  }, []);
  const value = useMemo(() => ({ pushToast }), [pushToast]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-region" role="status" aria-live="polite">
        {toasts.map((toast) => <div key={toast.id} className={`toast ${toast.tone}`}>{toast.text}</div>)}
      </div>
    </ToastContext.Provider>
  );
}

export function useToasts() {
  return useContext(ToastContext);
}

export function EmptyState({ title, text, icon }: { title: string; text: string; icon?: ReactNode }) {
  return <div className="empty-panel">{icon}<strong>{title}</strong><span>{text}</span></div>;
}

export function AttachmentButton({ disabled, onClick }: { disabled?: boolean; onClick?: () => void }) {
  return <button type="button" className="icon-button" title="Attach file" disabled={disabled} onClick={onClick}><Paperclip /></button>;
}

export function SlashCommandMenu({ onSelect }: { onSelect: (command: string) => void }) {
  return (
    <div className="suggestions" aria-label="Command suggestions">
      {["/request-file", "/send-file", "/agent-card", "/status"].map((command) => (
        <button key={command} type="button" onClick={() => onSelect(command)}>{command}</button>
      ))}
    </div>
  );
}

export function DateSeparator({ label }: { label: string }) {
  return <div className="date-separator" role="separator"><span>{label}</span></div>;
}
