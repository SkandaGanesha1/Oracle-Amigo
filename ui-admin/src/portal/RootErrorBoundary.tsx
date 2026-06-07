import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class RootErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo): void {
    // Keep sensitive runtime details out of logs; render a concise operator-facing failure.
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex h-full w-full items-center justify-center bg-black p-4 text-white">
        <div className="flex max-w-md flex-col gap-3 rounded-lg border border-rose-400/30 bg-[#0a0a0c] p-5 shadow-2xl">
          <div>
            <h1 className="text-sm font-semibold text-white">Admin portal failed to start</h1>
            <p className="mt-1 text-xs text-white/55">
              {this.state.error.message || "A frontend runtime error prevented the portal from rendering."}
            </p>
          </div>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex w-fit items-center justify-center rounded-md border border-white/10 bg-white/10 px-3 py-2 text-xs font-medium text-white hover:bg-white/15"
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}
