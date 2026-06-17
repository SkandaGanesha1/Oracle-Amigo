import { useEffect, useMemo, useState } from "react";
import { Waveform } from "./components/Waveform";
import { LocalAgentRequestError, LocalAgentVoiceClient } from "./lib/localAgentVoiceClient";
import { hideLauncherWindow, startLocalAgentSidecar } from "./lib/tauriBridge";
import { useHoldToTalk } from "./hooks/useHoldToTalk";
import "./styles.css";

export default function App() {
  const client = useMemo(() => new LocalAgentVoiceClient(), []);
  const [startupError, setStartupError] = useState<string | null>(null);
  const hold = useHoldToTalk({
    client,
    locale: "en-IN",
    onError: setStartupError
  });

  useEffect(() => {
    let active = true;
    void ensureAgent(client).catch((err) => {
      if (active) setStartupErrorFromUnknown(err);
    });

    function setStartupErrorFromUnknown(err: unknown) {
      setStartupError(err instanceof Error ? err.message : String(err));
    }

    return () => {
      active = false;
    };
  }, [client]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      hold.cancel();
      void hideLauncherWindow();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [hold.cancel]);

  const visibleText = [hold.transcript, hold.interimTranscript].filter(Boolean).join(" ");
  const statusText = startupError || hold.error || statusFor(hold.state);
  const command = hold.command;

  return (
    <main className="voice-shell" aria-live="polite">
      <section className="voice-content">
        <p className="transcript-line">
          {visibleText || " "}
        </p>
        <Waveform active={hold.isSpeaking} level={hold.voiceLevel} />
        <p className={startupError || hold.error ? "voice-hint voice-hint-error" : "voice-hint"}>
          {statusText}
        </p>
        {command && (
          <div className="voice-debug-panel">
            <div className="voice-debug-row">
              <span>Command</span>
              <strong>{shortId(command.id)}</strong>
            </div>
            <div className="voice-debug-row">
              <span>Status</span>
              <strong>{command.status}</strong>
            </div>
            <div className="voice-debug-row">
              <span>Parser</span>
              <strong>{String(command.parsed?.confidence ?? "-")}</strong>
            </div>
            <div className="voice-debug-row">
              <span>Target</span>
              <strong>{command.preview?.targetUser?.displayName ?? command.preview?.targetUser?.email ?? "-"}</strong>
            </div>
            <div className="voice-debug-row">
              <span>Relay</span>
              <strong>{command.relayTaskId ? shortId(command.relayTaskId) : "-"}</strong>
            </div>
            {command.errorMessage && <p className="voice-debug-error">{command.errorMessage}</p>}
            {hold.state === "preview_required" && !command.preview?.error && (
              <div className="voice-actions">
                <button type="button" onClick={() => void hold.confirm()}>
                  {command.preview?.actionLabel ?? "Confirm"}
                </button>
                <button type="button" className="secondary" onClick={hold.cancel}>
                  Cancel
                </button>
              </div>
            )}
          </div>
        )}
      </section>
    </main>
  );
}

async function ensureAgent(client: LocalAgentVoiceClient): Promise<void> {
  try {
    await client.status();
    return;
  } catch (statusError) {
    if (statusError instanceof LocalAgentRequestError && statusError.status === 404) {
      throw new Error("Restart Oracle Amigo so the local agent exposes /voice/status.");
    }
  }

  const reachable = await client.isLocalAgentReachable();
  if (reachable) {
    throw new Error("Restart the local agent with the latest Oracle Amigo build.");
  }

  await startLocalAgentSidecar();
  await waitForAgent(client);
}

async function waitForAgent(client: LocalAgentVoiceClient): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < 8000) {
    try {
      await client.status();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error("Local agent did not come online after startup.");
}

function statusFor(state: string): string {
  if (state === "listening") return "Release to send";
  if (state === "transcribing") return "Finishing transcript";
  if (state === "sending") return "Sending";
  if (state === "preview_required") return "Review and confirm";
  if (state === "failed") return "Command failed";
  return "Hold Ctrl+Space to speak";
}

function shortId(value: string): string {
  return value.length <= 14 ? value : `${value.slice(0, 6)}...${value.slice(-4)}`;
}
