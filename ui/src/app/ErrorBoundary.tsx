import { Component, type ErrorInfo, type ReactNode } from "react";
import * as Sentry from "@sentry/react";
import { AlertTriangle, RotateCcw } from "lucide-react";

interface ErrorBoundaryProps {
  children: ReactNode;
  title?: string;
  description?: string;
  className?: string;
  sentryContext?: Record<string, unknown>;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    Sentry.captureException(error, {
      contexts: {
        react: {
          componentStack: info.componentStack,
        },
        ...(this.props.sentryContext ? { route: this.props.sentryContext } : {}),
      },
    });
    console.error("Frontend render boundary caught an error", {
      message: error.message,
      componentStack: info.componentStack,
    });
  }

  reset = () => {
    this.setState({ error: null });
  };

  render() {
    if (!this.state.error) return this.props.children;

    const title = this.props.title ?? "Something went wrong";
    const description = this.props.description ?? "The chat UI hit a rendering error. Your local agent state is still intact.";
    const className = this.props.className ?? "flex min-h-screen items-center justify-center bg-oa-bg p-6 text-oa-text";

    return (
      <main className={className} role="alert">
        <section className="w-full max-w-md rounded-lg border border-oa-red/30 bg-oa-surface p-5 shadow-xl">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-oa-red/10 text-oa-red">
              <AlertTriangle className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h1 className="text-base font-semibold text-oa-text">{title}</h1>
              <p className="mt-1 text-sm text-oa-text-muted">{description}</p>
              <p className="mt-3 break-words rounded-md bg-oa-bg-elevated px-3 py-2 font-mono text-xs text-oa-text-muted">
                {this.state.error.message}
              </p>
              <button
                type="button"
                onClick={this.reset}
                className="mt-4 inline-flex min-h-[40px] items-center gap-2 rounded-md bg-oa-blue px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-oa-blue/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue focus-visible:ring-offset-2"
              >
                <RotateCcw className="h-4 w-4" />
                Try again
              </button>
            </div>
          </div>
        </section>
      </main>
    );
  }
}
