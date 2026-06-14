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
  cancel: () => void;
  error: string | null;
  interimTranscript: string;
  isHolding: boolean;
  isSpeaking: boolean;
  state: VoiceLauncherState;
  transcript: string;
  voiceLevel: number;
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
  const [isHolding, setIsHolding] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [voiceLevel, setVoiceLevel] = useState(0);
  const micRef = useRef<MicSession | null>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recorderMimeTypeRef = useRef("audio/webm");
  const recorderStopPromiseRef = useRef<Promise<Blob | null> | null>(null);
  const holdingRef = useRef(false);
  const finalTranscriptRef = useRef("");
  const interimTranscriptRef = useRef("");
  const releasePromiseRef = useRef<Promise<void> | null>(null);
  const hideTimerRef = useRef<number | null>(null);
  const vadFrameRef = useRef<number | null>(null);
  const speakingUntilRef = useRef(0);
  const smoothedLevelRef = useRef(0);

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
    setIsSpeaking(false);
    setVoiceLevel(0);
  }, []);

  const hideLauncherWindowSafe = useCallback(async () => {
    try {
      await Promise.race([
        hideLauncherWindow(),
        new Promise((resolve) => window.setTimeout(resolve, 450))
      ]);
    } catch {
      // Hiding is best-effort; release cleanup must not leave the mic or UI flow stuck.
    }
  }, []);

  const stopVoiceLoop = useCallback(() => {
    if (vadFrameRef.current !== null) window.cancelAnimationFrame(vadFrameRef.current);
    vadFrameRef.current = null;
    speakingUntilRef.current = 0;
    smoothedLevelRef.current = 0;
    setIsSpeaking(false);
    setVoiceLevel(0);
  }, []);

  const startVoiceLoop = useCallback((mic: MicSession) => {
    stopVoiceLoop();
    const tick = () => {
      const { peak, rms } = mic.sampleVoiceActivity();
      const rawLevel = Math.min(1, Math.max(rms / 0.12, peak / 0.38));
      smoothedLevelRef.current = (smoothedLevelRef.current * 0.72) + (rawLevel * 0.28);
      const now = Date.now();
      if (rms >= 0.035 || peak >= 0.16) speakingUntilRef.current = now + 220;
      const nextSpeaking = holdingRef.current && speakingUntilRef.current > now;
      setIsSpeaking(nextSpeaking);
      setVoiceLevel(nextSpeaking ? smoothedLevelRef.current : 0);
      vadFrameRef.current = window.requestAnimationFrame(tick);
    };
    vadFrameRef.current = window.requestAnimationFrame(tick);
  }, [stopVoiceLoop]);

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

  const startRecorder = useCallback((stream: MediaStream) => {
    recordedChunksRef.current = [];
    recorderStopPromiseRef.current = null;
    if (typeof MediaRecorder === "undefined") return;
    const mimeType = pickRecorderMimeType();
    const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    recorderMimeTypeRef.current = recorder.mimeType || mimeType || "audio/webm";
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) recordedChunksRef.current.push(event.data);
    };
    recorder.onerror = () => {
      recorderRef.current = null;
    };
    recorderRef.current = recorder;
    recorder.start(250);
  }, []);

  const stopRecorder = useCallback((): Promise<Blob | null> => {
    if (recorderStopPromiseRef.current) return recorderStopPromiseRef.current;
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (!recorder) return Promise.resolve(null);
    recorderStopPromiseRef.current = new Promise((resolve) => {
      const finish = () => {
        const chunks = recordedChunksRef.current;
        recordedChunksRef.current = [];
        resolve(chunks.length ? new Blob(chunks, { type: recorderMimeTypeRef.current }) : null);
      };
      recorder.onstop = finish;
      recorder.onerror = finish;
      try {
        if (recorder.state === "inactive") finish();
        else recorder.stop();
      } catch {
        finish();
      }
    });
    return recorderStopPromiseRef.current;
  }, []);

  const cancel = useCallback(() => {
    clearHideTimer();
    holdingRef.current = false;
    setIsHolding(false);
    stopRecognition();
    void stopRecorder();
    stopVoiceLoop();
    stopMic();
    setTranscript("");
    setInterimTranscript("");
    finalTranscriptRef.current = "";
    interimTranscriptRef.current = "";
    setState("hidden");
  }, [clearHideTimer, stopMic, stopRecognition, stopRecorder, stopVoiceLoop]);

  const startHold = useCallback(async () => {
    if (holdingRef.current) return;
    clearHideTimer();
    holdingRef.current = true;
    setIsHolding(true);
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
      setIsHolding(false);
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
      startVoiceLoop(mic);
      startRecorder(mic.stream);
    } catch (err) {
      holdingRef.current = false;
      setIsHolding(false);
      stopRecognition();
      void stopRecorder();
      stopVoiceLoop();
      stopMic();
      setFailure(err instanceof Error ? err.message : "Microphone permission was denied.");
      return;
    }

    const SpeechRecognitionImpl = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!SpeechRecognitionImpl) {
      setInterimTranscript("");
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
      stopRecognition();
      setError(event.message || event.error || "Speech recognition fallback active.");
    };
    recognitionRef.current = recognition;

    try {
      recognition.start();
    } catch (err) {
      stopRecognition();
      setError(err instanceof Error ? err.message : "Speech recognition fallback active.");
    }
  }, [clearHideTimer, locale, onError, setFailure, startRecorder, startVoiceLoop, stopMic, stopRecognition, stopRecorder, stopVoiceLoop]);

  const releaseHold = useCallback(async () => {
    if (!holdingRef.current) return;
    if (releasePromiseRef.current) return releasePromiseRef.current;

    releasePromiseRef.current = (async () => {
      holdingRef.current = false;
      setIsHolding(false);
      setState("transcribing");
      stopRecognition();
      stopVoiceLoop();
      const recordedAudio = await stopRecorder();
      stopMic();
      await new Promise((resolve) => setTimeout(resolve, 250));

      let finalText = normalizeTranscript(`${finalTranscriptRef.current} ${interimTranscriptRef.current}`);
      setTranscript(finalText);
      setInterimTranscript("");
      setState(finalText || recordedAudio ? "sending" : "hidden");
      await hideLauncherWindowSafe();

      if (!finalText && recordedAudio) {
        try {
          const result = await client.transcribeAudio(recordedAudio, { locale });
          finalText = normalizeTranscript(result.transcript);
        } catch (err) {
          const message = err instanceof Error ? err.message : "Voice transcription failed.";
          setFailure(message);
          return;
        }
      }
      setTranscript(finalText);

      if (!finalText) {
        setState("hidden");
        return;
      }

      setState("sending");
      try {
        await client.autoSendTranscript(finalText, { locale });
        setState("completed");
      } catch (err) {
        const message = err instanceof Error ? err.message : "Voice command failed.";
        setFailure(message);
      }
    })();

    return releasePromiseRef.current;
  }, [client, hideLauncherWindowSafe, locale, setFailure, stopMic, stopRecognition, stopRecorder, stopVoiceLoop]);

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
    cancel,
    error,
    interimTranscript,
    isHolding,
    isSpeaking,
    state,
    transcript,
    voiceLevel
  };
}

function isCtrlSpace(event: KeyboardEvent): boolean {
  return (event.ctrlKey || event.metaKey) && event.code === "Space";
}

function normalizeTranscript(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function pickRecorderMimeType(): string {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") return "";
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/wav"
  ];
  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? "";
}
