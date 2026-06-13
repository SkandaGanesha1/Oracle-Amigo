import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { LocalAgentRequestError, LocalAgentVoiceClient, type VoiceCommandRecord, type VoiceLauncherState } from "./lib/localAgentVoiceClient";
import { startMicAnalyser, type MicSession } from "./lib/mic";
import {
  getConfiguredShortcut,
  hideLauncherWindow,
  registerLauncherShortcut,
  showLauncherWindow,
  startLocalAgentSidecar,
  updateLauncherShortcut
} from "./lib/tauriBridge";
import { Waveform } from "./components/Waveform";
import "./styles.css";

export default function App() {
  const client = useMemo(() => new LocalAgentVoiceClient(), []);
  const [state, setState] = useState<VoiceLauncherState>("opening");
  const [transcript, setTranscript] = useState("");
  const [command, setCommand] = useState<VoiceCommandRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mic, setMic] = useState<MicSession | null>(null);
  const [shortcut, setShortcut] = useState(getConfiguredShortcut());
  const inputRef = useRef<HTMLInputElement | null>(null);
  const openLauncher = () => {
    setState("opening");
    void showLauncherWindow();
    setTimeout(() => inputRef.current?.focus(), 30);
  };

  useEffect(() => {
    void registerLauncherShortcut(openLauncher);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        stopMic();
        setCommand(null);
        setError(null);
        void hideLauncherWindow();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "l") {
        event.preventDefault();
        setTranscript("");
        setCommand(null);
        setError(null);
        setState("transcript_ready");
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "m") {
        event.preventDefault();
        void toggleMic();
      }
      if (event.key === "Enter" && command && !event.shiftKey) {
        event.preventDefault();
        if ((event.ctrlKey || event.metaKey) && command.preview.requiresConfirmation && command.parsed.confidence < 0.9) {
          setError("This command needs explicit confirmation because confidence is low.");
          return;
        }
        void confirm();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  useEffect(() => {
    void ensureAgent();
    return () => stopMic();
  }, []);

  async function ensureAgent() {
    setState("opening");
    try {
      await client.status();
      setState("transcript_ready");
      setTimeout(() => inputRef.current?.focus(), 30);
    } catch (statusError) {
      if (statusError instanceof LocalAgentRequestError && statusError.status === 404) {
        setState("failed");
        setError("A local agent is running, but it does not expose /voice/status. Stop the old agent process and restart it with the latest Oracle Amigo code.");
        return;
      }
      const reachable = await client.isLocalAgentReachable();
      if (reachable) {
        setState("failed");
        setError("A local service is running on the agent port, but Quick Voice could not reach /voice/status. Restart the local agent with the latest Oracle Amigo build.");
        return;
      }
      try {
        await startLocalAgentSidecar();
        await waitForAgent(client);
        setState("transcript_ready");
      } catch (err) {
        setState("failed");
        const reachableAfterStartup = await client.isLocalAgentReachable();
        setError(cleanStartupError(err, reachableAfterStartup));
      }
    }
  }

  async function toggleMic() {
    if (mic) {
      stopMic();
      setState("transcript_ready");
      return;
    }
    try {
      setState("requesting_mic_permission");
      const session = await startMicAnalyser();
      setMic(session);
      setState("listening");
    } catch (err) {
      setState("failed");
      setError(err instanceof Error ? err.message : "Microphone permission was denied.");
    }
  }

  function stopMic() {
    mic?.stop();
    setMic(null);
  }

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (!transcript.trim()) return;
    setState("parsing_command");
    setError(null);
    try {
      const next = await client.createCommand(transcript.trim());
      setCommand(next);
      setState(next.status === "failed" ? "failed" : "preview_required");
      setError(next.errorMessage);
    } catch (err) {
      setState("failed");
      setError(err instanceof Error ? err.message : "Command preview failed.");
    }
  }

  async function confirm() {
    if (!command) return;
    setState("executing");
    setError(null);
    try {
      const next = await client.confirmCommand(command.id);
      setCommand(next);
      if (next.relayTaskId) setState("waiting_remote_approval");
      else setState(next.status === "failed" ? "failed" : "completed");
      setError(next.errorMessage);
    } catch (err) {
      setState("failed");
      setError(err instanceof Error ? err.message : "Command confirmation failed.");
    }
  }

  async function cancel() {
    if (command) await client.cancelCommand(command.id).catch(() => null);
    setCommand(null);
    setState("transcript_ready");
  }

  async function changeShortcut(nextShortcut: string) {
    setShortcut(nextShortcut);
    await updateLauncherShortcut(nextShortcut, openLauncher).catch((err) => {
      setError(err instanceof Error ? err.message : "Shortcut update failed.");
    });
  }

  return (
    <main className="launcher-shell" aria-live="polite">
      <header className="launcher-header">
        <div>
          <span className="eyebrow">Oracle Amigo</span>
          <h1>Quick Voice</h1>
        </div>
        <div className="header-actions">
          <select
            value={shortcut}
            onChange={(event) => void changeShortcut(event.target.value)}
            aria-label="Global shortcut"
          >
            <option value="Ctrl+Space">Ctrl+Space</option>
            <option value="Ctrl+Shift+Space">Ctrl+Shift+Space</option>
            <option value="Alt+Space">Alt+Space</option>
            <option value="Alt+A">Alt+A</option>
          </select>
          <span className={`state-pill state-${state}`}>{labelForState(state)}</span>
        </div>
      </header>

      <Waveform analyser={mic?.analyser ?? null} active={Boolean(mic)} />

      <form className="command-form" onSubmit={submit}>
        <input
          ref={inputRef}
          value={transcript}
          onChange={(event) => {
            setTranscript(event.target.value);
            setCommand(null);
            setError(null);
            setState("transcript_ready");
          }}
          placeholder="Ask Docin to send me NonPO invoice india.pdf file"
          aria-label="Oracle Amigo command"
        />
        <button type="button" className={mic ? "mic active" : "mic"} onClick={toggleMic}>
          {mic ? "Stop" : "Mic"}
        </button>
        <button type="submit">Preview</button>
      </form>

      {command?.preview && (
        <section className="preview-panel">
          <div>
            <span className="eyebrow">{command.preview.intent.replaceAll("_", " ")}</span>
            <h2>{command.preview.title}</h2>
          </div>
          {command.preview.fileQuery && <p className="muted">File: {command.preview.fileQuery}</p>}
          {command.preview.targetUser && <p className="muted">Target: {command.preview.targetUser.displayName ?? command.preview.targetUser.email}</p>}
          {command.preview.dataMovementNote && <p className="notice">{command.preview.dataMovementNote}</p>}
          <div className="actions">
            <button type="button" onClick={cancel}>Cancel</button>
            <button type="button" className="primary" onClick={confirm} disabled={Boolean(command.preview.error)}>
              {command.preview.actionLabel}
            </button>
          </div>
        </section>
      )}

      {error && <p className="error">{error}</p>}
    </main>
  );
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

function labelForState(state: VoiceLauncherState): string {
  return state.replaceAll("_", " ");
}

function cleanStartupError(err: unknown, reachable: boolean): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (/EADDRINUSE|address already in use/i.test(raw)) {
    return "A local agent is already running on 127.0.0.1:3399. If Quick Voice still fails, stop that old process and restart the local agent so it includes the /voice/status API.";
  }
  if (reachable) {
    return "A local service is running on the agent port, but Quick Voice could not reach /voice/status. Restart the local agent with the latest Oracle Amigo build.";
  }
  if (/did not come online/i.test(raw)) {
    return "Quick Voice tried to start the local agent, but it did not come online. Start Oracle Amigo manually with npm.cmd run dev, then open Quick Voice again.";
  }
  return raw.split(/\r?\n/)[0] || "Local agent is offline.";
}
