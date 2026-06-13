import { useEffect, useRef, useState } from "react";
import { ShieldCheck, ShieldAlert, Loader } from "lucide-react";
import { api } from "../../api/client";
import { OracleTooltip } from "../../components/primitives/OracleTooltip";

interface VerifyHashButtonProps {
  fileId: string;
}

export function VerifyHashButton({ fileId }: VerifyHashButtonProps) {
  const [state, setState] = useState<"idle" | "verifying" | "verified" | "mismatch">("idle");
  const [sha256, setSha256] = useState<string | null>(null);
  const requestRef = useRef(0);

  useEffect(() => {
    requestRef.current += 1;
    setState("idle");
    setSha256(null);
  }, [fileId]);

  useEffect(() => {
    return () => {
      requestRef.current += 1;
    };
  }, []);

  async function handleVerify() {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setState("verifying");
    try {
      const result = await api.verifyFile(fileId);
      if (requestRef.current !== requestId) return;
      setSha256(result.sha256);
      setState(result.hash_verified ? "verified" : "mismatch");
    } catch {
      if (requestRef.current !== requestId) return;
      setState("mismatch");
    }
  }

  if (state === "verified") {
    return (
      <OracleTooltip content={
        <div className="space-y-1">
          <p className="text-[10px] font-medium text-oa-green">Hash Verified</p>
          <p className="font-mono text-[9px] text-oa-text-muted break-all">{sha256}</p>
        </div>
      }>
        <span className="inline-flex items-center gap-1 text-[10px] font-medium text-oa-green">
          <ShieldCheck className="h-3 w-3" />
          Verified
        </span>
      </OracleTooltip>
    );
  }

  if (state === "mismatch") {
    return (
      <OracleTooltip content="Hash verification failed — file may have been modified">
        <span className="inline-flex items-center gap-1 text-[10px] font-medium text-oa-red">
          <ShieldAlert className="h-3 w-3" />
          Hash Mismatch
        </span>
      </OracleTooltip>
    );
  }

  return (
    <button
      type="button"
      disabled={state === "verifying"}
      onClick={handleVerify}
      className="inline-flex items-center gap-1 rounded border border-oa-border bg-oa-surface px-2 py-1 text-[10px] text-oa-text-muted transition hover:bg-oa-surface-2 disabled:opacity-50"
    >
      {state === "verifying" ? (
        <Loader className="h-3 w-3 animate-spin" />
      ) : (
        <ShieldCheck className="h-3 w-3" />
      )}
      Verify Hash
    </button>
  );
}
