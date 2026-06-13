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
  }, [hold]);

  const visibleText = hold.transcript || hold.interimTranscript;
  const statusText = startupError || hold.error || statusFor(hold.state);

  return (
    <main className="voice-shell" aria-live="polite">
      <p className="transcript-line">
        {visibleText || " "}
      </p>
      <Waveform analyser={hold.analyser} active={hold.isHolding} />
      <p className={startupError || hold.error ? "voice-hint voice-hint-error" : "voice-hint"}>
        {statusText}
      </p>
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
  if (state === "failed") return "Command failed";
  return "Hold Ctrl+Space to speak";
}
