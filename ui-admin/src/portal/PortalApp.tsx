import { LifeBuoy, Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FC } from "react";
import { LoginFlow } from "./auth/LoginFlow";
import { SetupFlow } from "./auth/SetupFlow";
import { useSession } from "./auth/useSession";
import { useSetupStatus } from "./auth/useSetupStatus";
import { AdminLayout } from "./layout/AdminLayout";
import type { AdminSessionUser } from "./auth/types";

export const PortalApp: FC = () => {
  const session = useSession();
  const setup = useSetupStatus();
  const [recoveryNotice, setRecoveryNotice] = useState<string[] | null>(null);
  const clipboardClearTimerRef = useRef<number | null>(null);

  const clearClipboardTimer = useCallback(() => {
    if (clipboardClearTimerRef.current !== null) {
      window.clearTimeout(clipboardClearTimerRef.current);
      clipboardClearTimerRef.current = null;
    }
  }, []);

  const scheduleClipboardClear = useCallback(() => {
    clearClipboardTimer();
    clipboardClearTimerRef.current = window.setTimeout(() => {
      clipboardClearTimerRef.current = null;
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        void navigator.clipboard.writeText("").catch(() => undefined);
      }
      setRecoveryNotice(null);
    }, 120000);
  }, [clearClipboardTimer]);

  const dismissRecoveryNotice = useCallback(() => {
    setRecoveryNotice(null);
  }, []);

  const handleLogin = useCallback(
    (user: AdminSessionUser) => {
      session.applyLogin(user);
    },
    [session]
  );

  const handleSetup = useCallback(
    async (recoveryCodes: string[]) => {
      // Cookie is now set by the server; refresh session to load /me.
      setRecoveryNotice(recoveryCodes);
      await session.refresh();
    },
    [session]
  );

  useEffect(() => {
    if (session.status !== "authenticated") {
      clearClipboardTimer();
      dismissRecoveryNotice();
      return;
    }
    if (!recoveryNotice) return;

    scheduleClipboardClear();
  }, [clearClipboardTimer, dismissRecoveryNotice, recoveryNotice, scheduleClipboardClear, session.status]);

  useEffect(() => clearClipboardTimer, [clearClipboardTimer]);

  if (session.status === "loading" || setup.isLoading) {
    return <FullScreenSpinner label="Checking session…" />;
  }

  if (session.status === "authenticated" && session.user) {
    return (
      <div className="flex h-full w-full flex-col gap-3">
        {recoveryNotice && (
          <RecoveryBanner
            codes={recoveryNotice}
            onClearClipboardLater={scheduleClipboardClear}
            onDismiss={dismissRecoveryNotice}
          />
        )}
        {session.lastError && !recoveryNotice && (
          <Notice tone="warn" message={session.lastError} onDismiss={() => session.clear()} />
        )}
        <div className="min-h-0 flex-1">
          <AdminLayout session={session} />
        </div>
      </div>
    );
  }

  if (setup.data?.required) {
    return (
      <CenteredShell>
        <SetupFlow onCompleted={handleSetup} />
      </CenteredShell>
    );
  }

  return (
    <CenteredShell>
      {session.lastError && <Notice tone="error" message={session.lastError} onDismiss={() => session.clear()} />}
      <LoginFlow onAuthenticated={handleLogin} />
    </CenteredShell>
  );
};

const FullScreenSpinner: FC<{ label: string }> = ({ label }) => (
  <div className="flex h-full w-full items-center justify-center">
    <div className="flex items-center gap-2 text-xs text-white/55">
      <Loader2 className="h-4 w-4 animate-spin text-emerald-300" /> {label}
    </div>
  </div>
);

const CenteredShell: FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="flex h-full w-full items-center justify-center p-4">
    <div className="flex flex-col items-center gap-3">{children}</div>
  </div>
);

interface NoticeProps {
  tone: "warn" | "error";
  message: string;
  onDismiss: () => void;
}

const Notice: FC<NoticeProps> = ({ tone, message, onDismiss }) => {
  const cls =
    tone === "warn"
      ? "border-amber-400/30 bg-amber-400/10 text-amber-100"
      : "border-rose-400/30 bg-rose-400/10 text-rose-100";
  return (
    <div className={`flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-xs ${cls}`}>
      <span>{message}</span>
      <button
        type="button"
        onClick={onDismiss}
        className="text-[11px] underline-offset-2 hover:underline"
      >
        Dismiss
      </button>
    </div>
  );
};

const RecoveryBanner: FC<{
  codes: string[];
  onClearClipboardLater: () => void;
  onDismiss: () => void;
}> = ({ codes, onClearClipboardLater, onDismiss }) => {
  const copy = async () => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      await navigator.clipboard.writeText(codes.join("\n")).catch(() => undefined);
      onClearClipboardLater();
    }
  };
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-[11px] text-amber-100">
      <span className="inline-flex items-center gap-1.5">
        <LifeBuoy className="h-3 w-3" />
        Your recovery codes have been rotated. Copy the new set; clipboard contents may remain visible to other local apps until cleared.
      </span>
      <span className="flex items-center gap-2">
        <button type="button" onClick={copy} className="underline-offset-2 hover:underline">
          Copy new codes
        </button>
        <button type="button" onClick={onDismiss} className="underline-offset-2 hover:underline">
          Dismiss
        </button>
      </span>
    </div>
  );
};
