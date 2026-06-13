import { useCallback, useEffect, useRef, useState } from "react";
import { startMicAnalyser, type MicSession } from "../lib/mic";
import { hideLauncherWindow, listenToVoiceShortcutEvents, showLauncherWindow } from "../lib/tauriBridge";
import type { LocalAgentVoiceClient, VoiceLauncherState } from "../lib/localAgentVoiceClient";

interface UseHoldToTalkOptions {
  client: LocalAgentVoiceClient;
  locale: string;
  onError: (message: string | null) => void;
}

interface UseHoldToTalkResult {
  analyser: AnalyserNode | null;
  cancel: () => void;
  error: string | null;
  interimTranscript: string;
  isHolding: boolean;
  state: VoiceLauncherState;
  transcript: string;
}

type SpeechRecognitionEventLike = Event & {
  resultIndex: number;
  results: SpeechRecognitionResultList;
};

type SpeechRecognitionErrorEventLike = Event & {
  error?: string;
  message?: string;
};

type SpeechRecognitionConstructor = new () => SpeechRecognition;

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

export function useHoldToTalk({ client, locale, onError }: UseHoldToTalkOptions): UseHoldToTalkResult {
  const [state, setState] = useState<VoiceLauncherState>("hidden");
  const [transcript, setTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const micRef = useRef<MicSession | null>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const holdingRef = useRef(false);
  const finalTranscriptRef = useRef("");
  const interimTranscriptRef = useRef("");
  const releasePromiseRef = useRef<Promise<void> | null>(null);
  const hideTimerRef = useRef<number | null>(null);

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current === null) return;
    window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = null;
  }, []);

  const setFailure = useCallback((message: string) => {
    setState("failed");
    setError(message);
    onError(message);
  }, [onError]);

  const stopMic = useCallback(() => {
    micRef.current?.stop();
    micRef.current = null;
    setAnalyser(null);
  }, []);

  const stopRecognition = useCallback(() => {
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    if (!recognition) return;
    recognition.onresult = null;
    recognition.onerror = null;
    recognition.onend = null;
    try {
      recognition.stop();
    } catch {
      try {
        recognition.abort();
      } catch {
        // Ignore shutdown races from browser speech APIs.
      }
    }
  }, []);

  const cancel = useCallback(() => {
    clearHideTimer();
    holdingRef.current = false;
    stopRecognition();
    stopMic();
    setTranscript("");
    setInterimTranscript("");
    finalTranscriptRef.current = "";
    interimTranscriptRef.current = "";
    setState("hidden");
  }, [clearHideTimer, stopMic, stopRecognition]);

  const startHold = useCallback(async () => {
    if (holdingRef.current) return;
    clearHideTimer();
    holdingRef.current = true;
    releasePromiseRef.current = null;
    finalTranscriptRef.current = "";
    interimTranscriptRef.current = "";
    setTranscript("");
    setInterimTranscript("");
    setError(null);
    onError(null);
    setState("listening");

    try {
      await showLauncherWindow();
    } catch (err) {
      holdingRef.current = false;
      setFailure(err instanceof Error ? err.message : "Failed to show voice launcher.");
      return;
    }

    try {
      const mic = await startMicAnalyser();
      if (!holdingRef.current) {
        mic.stop();
        return;
      }
      micRef.current = mic;
      setAnalyser(mic.analyser);
    } catch (err) {
      holdingRef.current = false;
      stopRecognition();
      stopMic();
      setFailure(err instanceof Error ? err.message : "Microphone permission was denied.");
      return;
    }

    const SpeechRecognitionImpl = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!SpeechRecognitionImpl) {
      holdingRef.current = false;
      stopRecognition();
      stopMic();
      setFailure("Speech recognition unavailable.");
      return;
    }

    const recognition = new SpeechRecognitionImpl();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = locale;
    recognition.onresult = (event) => {
      let finalText = "";
      let interimText = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const text = result[0]?.transcript?.trim() ?? "";
        if (!text) continue;
        if (result.isFinal) finalText += `${text} `;
        else interimText += `${text} `;
      }
      if (finalText) {
        finalTranscriptRef.current = normalizeTranscript(`${finalTranscriptRef.current} ${finalText}`);
        setTranscript(finalTranscriptRef.current);
      }
      interimTranscriptRef.current = normalizeTranscript(interimText);
      setInterimTranscript(interimTranscriptRef.current);
    };
    recognition.onerror = (event) => {
      if (!holdingRef.current) return;
      holdingRef.current = false;
      stopRecognition();
      stopMic();
      setFailure(event.message || event.error || "Speech recognition failed.");
    };
    recognitionRef.current = recognition;

    try {
      recognition.start();
    } catch (err) {
      holdingRef.current = false;
      stopRecognition();
      stopMic();
      setFailure(err instanceof Error ? err.message : "Speech recognition failed to start.");
    }
  }, [clearHideTimer, locale, onError, setFailure, stopMic, stopRecognition]);

  const releaseHold = useCallback(async () => {
    if (!holdingRef.current) return;
    if (releasePromiseRef.current) return releasePromiseRef.current;

    releasePromiseRef.current = (async () => {
      holdingRef.current = false;
      setState("transcribing");
      stopRecognition();
      stopMic();
      await new Promise((resolve) => setTimeout(resolve, 250));

      const finalText = normalizeTranscript(`${finalTranscriptRef.current} ${interimTranscriptRef.current}`);
      setTranscript(finalText);
      setInterimTranscript("");

      if (!finalText) {
        setState("hidden");
        await hideLauncherWindow();
        return;
      }

      setState("sending");
      try {
        await client.autoSendTranscript(finalText, { locale });
        setState("completed");
        await hideLauncherWindow();
      } catch (err) {
        const message = err instanceof Error ? err.message : "Voice command failed.";
        setFailure(message);
        clearHideTimer();
        hideTimerRef.current = window.setTimeout(() => {
          hideTimerRef.current = null;
          void hideLauncherWindow();
        }, 1600);
      }
    })();

    return releasePromiseRef.current;
  }, [clearHideTimer, client, locale, setFailure, stopMic, stopRecognition]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    void listenToVoiceShortcutEvents({
      onStart: () => void startHold(),
      onStop: () => void releaseHold()
    }).then((nextUnlisten) => {
      if (disposed) {
        nextUnlisten();
        return;
      }
      unlisten = nextUnlisten;
    });

    const onKeyDown = (event: KeyboardEvent) => {
      if (isCtrlSpace(event) && !event.repeat) {
        event.preventDefault();
        void startHold();
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (isCtrlSpace(event)) {
        event.preventDefault();
        void releaseHold();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    return () => {
      disposed = true;
      unlisten?.();
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      cancel();
    };
  }, [cancel, releaseHold, startHold]);

  return {
    analyser,
    cancel,
    error,
    interimTranscript,
    isHolding: holdingRef.current,
    state,
    transcript
  };
}

function isCtrlSpace(event: KeyboardEvent): boolean {
  return (event.ctrlKey || event.metaKey) && event.code === "Space";
}

function normalizeTranscript(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
