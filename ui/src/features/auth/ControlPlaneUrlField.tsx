import { useState } from "react";
import { Wifi, WifiOff, Loader } from "lucide-react";
import { api } from "../../api/client";
import { cn } from "~/lib/utils";

interface ControlPlaneUrlFieldProps {
  value: string;
  onChange: (url: string) => void;
  error?: string | null;
}

type ConnectionState = "idle" | "testing" | "ok" | "unreachable";

export function ControlPlaneUrlField({ value, onChange, error }: ControlPlaneUrlFieldProps) {
  const [connectionState, setConnectionState] = useState<ConnectionState>("idle");

  async function testConnection() {
    if (!value.trim()) return;
    setConnectionState("testing");
    try {
      const result = await api.cloudStatus();
      if (result.controlPlane?.reachable || result.cloud.status !== "disconnected") {
        setConnectionState("ok");
      } else {
        setConnectionState("unreachable");
      }
    } catch {
      setConnectionState("unreachable");
    }
  }

  const showTestButton = value.trim().length > 0 && connectionState !== "testing";

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor="control-plane-url" className="text-xs font-medium text-oa-text-secondary">
        Control Plane URL
        <span className="ml-1 text-oa-text-muted">(optional)</span>
      </label>
      <div className="flex gap-2">
        <input
          id="control-plane-url"
          type="url"
          value={value}
          onChange={(e) => {
            onChange(e.currentTarget.value);
            if (connectionState !== "idle") setConnectionState("idle");
          }}
          placeholder="https://control.example.com"
          className="flex-1 rounded-lg border border-oa-border bg-oa-bg-elevated px-3 py-2 text-sm text-oa-text placeholder-oa-text-disabled transition-colors focus:border-oa-blue focus:outline-none"
          autoComplete="url"
        />
        {connectionState === "testing" && (
          <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-oa-border bg-oa-bg-elevated">
            <Loader className="h-4 w-4 animate-spin text-oa-text-muted" />
          </span>
        )}
        {showTestButton && (
          <button
            type="button"
            onClick={testConnection}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-oa-border bg-oa-bg-elevated transition-colors hover:border-oa-blue hover:text-oa-blue"
            aria-label="Test connection"
            title="Test connection"
          >
            {connectionState === "ok" ? (
              <Wifi className="h-4 w-4 text-oa-green" />
            ) : connectionState === "unreachable" ? (
              <WifiOff className="h-4 w-4 text-oa-red" />
            ) : (
              <Wifi className="h-4 w-4" />
            )}
          </button>
        )}
      </div>
      {error && <p className="text-xs text-oa-red">{error}</p>}
      {connectionState === "ok" && <p className="text-xs text-oa-green">Control plane reachable</p>}
      {connectionState === "unreachable" && <p className="text-xs text-oa-red">Control plane unreachable</p>}
    </div>
  );
}
