import EmojiPicker, { Theme } from "emoji-picker-react";
import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { PromptInput, PromptInputTextarea, PromptInputActions, PromptInputAction } from "~/components/ui/prompt-input";
import { ArrowUp, Command, LoaderCircle, Mic, Paperclip, Smile, StopCircle, User } from "lucide-react";
import { Popover } from "radix-ui";
import { FileRequestIntentChip, matchFileRequestIntent } from "../../features/chat/FileRequestIntentChip";
import { api } from "../../api/client";
import { useCreateVoiceCommand } from "../../hooks/queries";

interface AgentMention {
  id: string;
  name: string;
  subtitle?: string;
}

interface MessageComposerProps {
  conversationId: string;
  onSend: (text: string, sendAs: "normal" | "file_request") => Promise<void>;
  disabled?: boolean;
  availableAgents?: AgentMention[];
}

const SLASH_COMMANDS = [
  { command: "/request-file", description: "Request a file from the agent" },
  { command: "/send-file", description: "Send a file to another agent" },
  { command: "/agent-card", description: "View agent capabilities" },
  { command: "/status", description: "Check agent status" },
  { command: "/help", description: "Show available commands" },
];

const DEFAULT_AGENTS: AgentMention[] = [
  { id: "local", name: "Local Agent", subtitle: "This device" },
];

type VoiceComposerState = "idle" | "starting" | "recording" | "transcribing" | "processing" | "error";

interface ComposerSpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface ComposerSpeechRecognitionResult {
  readonly length: number;
  readonly isFinal: boolean;
  item(index: number): ComposerSpeechRecognitionAlternative;
  [index: number]: ComposerSpeechRecognitionAlternative;
}

interface ComposerSpeechRecognitionResultList {
  readonly length: number;
  item(index: number): ComposerSpeechRecognitionResult;
  [index: number]: ComposerSpeechRecognitionResult;
}

interface ComposerSpeechRecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: ComposerSpeechRecognitionResultList;
}

interface ComposerSpeechRecognitionErrorEvent extends Event {
  readonly error: string;
}

interface ComposerSpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onstart: ((this: ComposerSpeechRecognition, event: Event) => void) | null;
  onend: ((this: ComposerSpeechRecognition, event: Event) => void) | null;
  onresult: ((this: ComposerSpeechRecognition, event: ComposerSpeechRecognitionEvent) => void) | null;
  onerror: ((this: ComposerSpeechRecognition, event: ComposerSpeechRecognitionErrorEvent) => void) | null;
}

type ComposerSpeechRecognitionConstructor = new () => ComposerSpeechRecognition;

function ComposerDivider() {
  return <span className="oa-composer-action-divider" aria-hidden="true" />;
}

function getSpeechRecognitionConstructor(): ComposerSpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const speechWindow = window as Window & {
    SpeechRecognition?: ComposerSpeechRecognitionConstructor;
    webkitSpeechRecognition?: ComposerSpeechRecognitionConstructor;
  };
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null;
}

function formatVoiceElapsed(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
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

export function MessageComposer({ conversationId, onSend, disabled, availableAgents }: MessageComposerProps) {
  const [text, setText] = useState("");
  const [showCommands, setShowCommands] = useState(false);
  const [commandIndex, setCommandIndex] = useState(0);
  const [showMentions, setShowMentions] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionIndex, setMentionIndex] = useState(0);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [voiceState, setVoiceState] = useState<VoiceComposerState>("idle");
  const [voiceElapsed, setVoiceElapsed] = useState(0);
  const [voiceInterim, setVoiceInterim] = useState("");
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [voiceLevels, setVoiceLevels] = useState<number[]>(() =>
    Array.from({ length: 32 }, (_, index) => 26 + ((index * 17) % 54))
  );
  const recognitionRef = useRef<ComposerSpeechRecognition | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recorderMimeTypeRef = useRef("audio/webm");
  const recorderStopPromiseRef = useRef<Promise<Blob | null> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const voiceStartedAtRef = useRef<number>(0);
  const finalTranscriptRef = useRef("");
  const createVoiceCommand = useCreateVoiceCommand();

  const isFileRequest = matchFileRequestIntent(text);
  const composerMode = isFileRequest ? "file_request" : "normal";
  const hasText = text.trim().length > 0;
  const isVoiceActive = voiceState === "starting" || voiceState === "recording" || voiceState === "transcribing" || voiceState === "processing";
  const canStartVoice = !disabled && !hasText && (voiceState === "idle" || voiceState === "error");

  const filteredCommands = text.startsWith("/")
    ? SLASH_COMMANDS.filter((c) => c.command.startsWith(text.toLowerCase()))
    : [];

  const agents = useMemo(() => availableAgents ?? DEFAULT_AGENTS, [availableAgents]);

  const filteredMentions = useMemo(() => {
    if (!showMentions) return [];
    return agents.filter((a) =>
      a.name.toLowerCase().includes(mentionQuery.toLowerCase())
    );
  }, [showMentions, mentionQuery, agents]);

  const stopVoiceMeter = useCallback(() => {
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    void audioContextRef.current?.close();
    audioContextRef.current = null;
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
      // Browser speech implementations can throw if stop races with startup.
    }
  }, []);

  const stopMicStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const stopVoiceResources = useCallback(() => {
    stopRecognition();
    stopVoiceMeter();
    stopMicStream();
    recorderRef.current = null;
    recordedChunksRef.current = [];
    recorderStopPromiseRef.current = null;
  }, [stopMicStream, stopRecognition, stopVoiceMeter]);

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

  const startVoiceMeter = useCallback((stream: MediaStream) => {
    const audioWindow = window as Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext };
    const AudioContextCtor = audioWindow.AudioContext ?? audioWindow.webkitAudioContext;
    if (!AudioContextCtor) return;

    const audioContext = new AudioContextCtor();
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 64;
    audioContext.createMediaStreamSource(stream).connect(analyser);
    audioContextRef.current = audioContext;

    const frequencyData = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      analyser.getByteFrequencyData(frequencyData);
      const nextLevels = Array.from({ length: 32 }, (_, index) => {
        const raw = frequencyData[index] ?? 0;
        return Math.max(18, Math.min(92, Math.round((raw / 255) * 86) + 12));
      });
      setVoiceLevels(nextLevels);
      animationFrameRef.current = window.requestAnimationFrame(tick);
    };
    tick();
  }, []);

  function getAtMentionState(v: string): { active: boolean; query: string } {
    const lastAtIndex = v.lastIndexOf("@");
    if (lastAtIndex === -1) return { active: false, query: "" };
    const afterAt = v.slice(lastAtIndex + 1);
    if (/[\s@]/.test(afterAt) || afterAt.length === 0) return { active: false, query: "" };
    const beforeAt = lastAtIndex === 0 ? "" : v[lastAtIndex - 1];
    if (beforeAt && !/\s/.test(beforeAt)) return { active: false, query: "" };
    return { active: true, query: afterAt };
  }

  const handleSubmit = useCallback(() => {
    if (!text.trim() || disabled) return;
    stopVoiceResources();
    setVoiceState("idle");
    setVoiceError(null);
    const sendAs = isFileRequest ? "file_request" : "normal";
    void onSend(text.trim(), sendAs);
    setText("");
    setShowCommands(false);
    setShowMentions(false);
  }, [text, disabled, isFileRequest, onSend, stopVoiceResources]);

  const startVoiceCommand = useCallback(async () => {
    if (!canStartVoice) return;

    if (!navigator.mediaDevices?.getUserMedia) {
      setVoiceState("error");
      setVoiceError("Microphone access is not available in this browser.");
      return;
    }

    setVoiceState("starting");
    setVoiceElapsed(0);
    setVoiceInterim("");
    setVoiceError(null);
    finalTranscriptRef.current = "";
    setShowCommands(false);
    setShowMentions(false);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      startVoiceMeter(stream);
      startRecorder(stream);

      const SpeechRecognitionCtor = getSpeechRecognitionConstructor();
      if (!SpeechRecognitionCtor) {
        voiceStartedAtRef.current = Date.now();
        setVoiceState("recording");
        return;
      }
      const recognition = new SpeechRecognitionCtor();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = navigator.language || "en-US";
      recognition.onstart = () => {
        voiceStartedAtRef.current = Date.now();
        setVoiceState("recording");
      };
      recognition.onresult = (event) => {
        let interim = "";
        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const result = event.results[index];
          const transcript = result[0]?.transcript?.trim();
          if (!transcript) continue;
          if (result.isFinal) {
            finalTranscriptRef.current = `${finalTranscriptRef.current} ${transcript}`.trim();
          } else {
            interim = `${interim} ${transcript}`.trim();
          }
        }
        setVoiceInterim(interim);
      };
      recognition.onerror = (event) => {
        if (event.error === "not-allowed") {
          void stopRecorder();
          stopVoiceResources();
          setVoiceState("error");
          setVoiceError("Microphone permission was denied.");
          return;
        }
        stopRecognition();
      };
      recognitionRef.current = recognition;
      recognition.start();
    } catch (error) {
      stopVoiceResources();
      setVoiceState("error");
      setVoiceError(error instanceof Error && error.name === "NotAllowedError" ? "Microphone permission was denied." : "Could not start microphone capture.");
    }
  }, [canStartVoice, startRecorder, startVoiceMeter, stopRecognition, stopRecorder, stopVoiceResources]);

  const stopVoiceCommand = useCallback(async (submitTranscript = true) => {
    let transcript = `${finalTranscriptRef.current} ${voiceInterim}`.trim();
    stopRecognition();
    setVoiceState("transcribing");
    const recordedAudio = await stopRecorder();
    stopVoiceMeter();
    stopMicStream();
    setVoiceInterim("");

    if (!submitTranscript) {
      setVoiceState("idle");
      setVoiceError(null);
      finalTranscriptRef.current = "";
      return;
    }

    if (!transcript && recordedAudio) {
      try {
        const result = await api.transcribeVoiceAudio(recordedAudio, {
          locale: navigator.language || "en-US",
          source: "chat-composer"
        });
        transcript = result.transcript.trim();
        if (transcript) {
          finalTranscriptRef.current = transcript;
          setVoiceInterim("");
          setVoiceState("processing");
          setVoiceError(null);
          await createVoiceCommand.mutateAsync({
            transcript,
            source: "chat-composer",
            input_mode: "speech",
            locale: navigator.language || "en-US",
            stt: {
              provider: result.provider,
              confidence: result.confidence
            }
          });
          finalTranscriptRef.current = "";
          setVoiceState("idle");
          setVoiceElapsed(0);
          return;
        }
      } catch (error) {
        setVoiceState("error");
        setVoiceError(error instanceof Error ? error.message : "Voice transcription failed.");
        return;
      }
    }

    if (!transcript) {
      setVoiceState("error");
      setVoiceError("No speech was detected. Try again when you are ready.");
      return;
    }

    setVoiceState("processing");
    setVoiceError(null);
    try {
      await createVoiceCommand.mutateAsync({
        transcript,
        source: "chat-composer",
        input_mode: "speech",
        locale: navigator.language || "en-US",
        stt: {
          provider: "browser"
        }
      });
      finalTranscriptRef.current = "";
      setVoiceState("idle");
      setVoiceElapsed(0);
    } catch (error) {
      setVoiceState("error");
      setVoiceError(error instanceof Error ? error.message : "Could not submit the voice command.");
    }
  }, [createVoiceCommand, stopMicStream, stopRecognition, stopRecorder, stopVoiceMeter, voiceInterim]);

  useEffect(() => {
    if (voiceState !== "recording") return;
    const interval = window.setInterval(() => {
      setVoiceElapsed(Math.max(0, Math.floor((Date.now() - voiceStartedAtRef.current) / 1000)));
    }, 250);
    return () => window.clearInterval(interval);
  }, [voiceState]);

  useEffect(() => () => stopVoiceResources(), [stopVoiceResources]);

  function insertAgentMention(agent: AgentMention) {
    const lastAtIndex = text.lastIndexOf("@");
    if (lastAtIndex === -1) return;
    const before = text.slice(0, lastAtIndex);
    const after = text.slice(lastAtIndex + mentionQuery.length + 1);
    setText(`${before}@${agent.name} ${after}`);
    setShowMentions(false);
    setMentionQuery("");
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      if (isVoiceActive) {
        e.preventDefault();
        void stopVoiceCommand(false);
        return;
      }
      if (showCommands) {
        e.preventDefault();
        setShowCommands(false);
        return;
      }
      if (showMentions) {
        e.preventDefault();
        setShowMentions(false);
        return;
      }
      (e.currentTarget as HTMLElement).closest('textarea')?.blur();
      return;
    }
    if (showMentions && filteredMentions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionIndex((i) => Math.min(i + 1, filteredMentions.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if ((e.key === "Enter" || e.key === "Tab") && !e.shiftKey) {
        e.preventDefault();
        insertAgentMention(filteredMentions[mentionIndex]);
        return;
      }
    }
    if (filteredCommands.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setCommandIndex((i) => Math.min(i + 1, filteredCommands.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setCommandIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter" && !e.shiftKey && filteredCommands.length > 0 && commandIndex >= 0) {
        e.preventDefault();
        setText(filteredCommands[commandIndex].command + " ");
        setShowCommands(false);
        setCommandIndex(0);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  function openCommandPalette() {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }));
  }

  function startFileRequest() {
    if (!text.trim()) {
      setText("/request-file ");
    } else if (!isFileRequest) {
      setText(`/request-file ${text.trim()}`);
    }
    setShowCommands(false);
    setShowMentions(false);
    requestAnimationFrame(() => {
      document.querySelector<HTMLTextAreaElement>("[data-oa-composer-input='true']")?.focus();
    });
  }

  function insertEmoji(emoji: string) {
    setText((current) => `${current}${emoji}`);
    setEmojiPickerOpen(false);
    requestAnimationFrame(() => {
      document.querySelector<HTMLTextAreaElement>("[data-oa-composer-input='true']")?.focus();
    });
  }

  function handlePrimaryAction() {
    if (hasText) {
      handleSubmit();
      return;
    }
    if (voiceState === "recording") {
      void stopVoiceCommand(true);
      return;
    }
    if (canStartVoice) {
      void startVoiceCommand();
    }
  }

  const primaryActionLabel = hasText
    ? "Send message"
    : voiceState === "recording"
      ? "Stop voice command"
      : voiceState === "transcribing"
        ? "Finishing transcript"
      : voiceState === "processing"
        ? "Processing voice command"
        : "Start voice command";
  const primaryActionTooltip = hasText
    ? "Send message"
    : voiceState === "recording"
      ? "Stop voice command"
      : voiceState === "transcribing"
        ? "Finishing transcript"
      : voiceState === "processing"
        ? "Processing voice command"
        : "Voice command";
  const PrimaryActionIcon = hasText ? ArrowUp : voiceState === "recording" ? StopCircle : voiceState === "processing" || voiceState === "starting" || voiceState === "transcribing" ? LoaderCircle : Mic;
  const primaryActionIconClass = hasText || voiceState === "starting" || voiceState === "processing" || voiceState === "transcribing"
    ? "h-4 w-4"
    : "h-5 w-5";
  return (
    <div className="oa-composer-dock density-composer">
      {composerMode === "file_request" && (
        <div className="oa-composer-mode-row">
          <FileRequestIntentChip visible={true} />
          <span>Send file request? The agent must ask before any file leaves this device.</span>
        </div>
      )}

      <div className="oa-composer-glow-shell" data-recording={isVoiceActive ? "true" : "false"}>
        <div className="oa-composer-glow-layer oa-composer-glow-layer--soft" aria-hidden="true" />
        <div className="oa-composer-glow-layer oa-composer-glow-layer--line" aria-hidden="true" />
        <PromptInput
          value={text}
          onValueChange={(v) => {
            setText(v);
            if (v.startsWith("/") && !v.includes(" ")) {
              setShowCommands(true);
              setCommandIndex(0);
              setShowMentions(false);
            } else {
              setShowCommands(false);
            }
            const mentionState = getAtMentionState(v);
            if (mentionState.active) {
              setShowMentions(true);
              setMentionQuery(mentionState.query);
              setMentionIndex(0);
            } else {
              setShowMentions(false);
            }
          }}
          onSubmit={handleSubmit}
          disabled={disabled}
          className="oa-composer-frame"
          data-recording={isVoiceActive ? "true" : "false"}
        >
          <div className="oa-composer-suggestions-layer">
            {showCommands && filteredCommands.length > 0 && (
              <div className="oa-composer-suggestion-menu" role="listbox" aria-label="Slash commands">
                {filteredCommands.map((cmd, i) => (
                  <button
                    key={cmd.command}
                    type="button"
                    role="option"
                    aria-selected={i === commandIndex}
                    className="oa-composer-suggestion-row"
                    data-active={i === commandIndex}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setText(cmd.command + " ");
                      setShowCommands(false);
                    }}
                  >
                    <Command className="h-3 w-3 shrink-0" />
                    <span className="font-medium">{cmd.command}</span>
                    <span className="text-oa-text-muted">{cmd.description}</span>
                  </button>
                ))}
              </div>
            )}

            {showMentions && filteredMentions.length > 0 && (
              <div className="oa-composer-suggestion-menu" role="listbox" aria-label="Agent mentions">
                {filteredMentions.map((agent, i) => (
                  <button
                    key={agent.id}
                    type="button"
                    role="option"
                    aria-selected={i === mentionIndex}
                    className="oa-composer-suggestion-row"
                    data-active={i === mentionIndex}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      insertAgentMention(agent);
                    }}
                  >
                    <User className="h-3.5 w-3.5 shrink-0 text-oa-text-muted" />
                    <span className="font-medium">{agent.name}</span>
                    {agent.subtitle && <span className="text-oa-text-muted">{agent.subtitle}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          {isVoiceActive ? (
            <div className="oa-composer-voice-recorder" role="status" aria-live="polite">
              <div className="oa-composer-voice-timer">
                <span className="oa-composer-voice-dot" aria-hidden="true" />
                <span>{voiceState === "transcribing" ? "Finishing transcript" : voiceState === "processing" ? "Processing" : formatVoiceElapsed(voiceElapsed)}</span>
              </div>
              <div className="oa-composer-voice-visualizer" aria-hidden="true">
                {voiceLevels.map((level, index) => (
                  <span key={index} style={{ height: `${level}%` }} />
                ))}
              </div>
              {voiceInterim && <p className="oa-composer-voice-interim">{voiceInterim}</p>}
            </div>
          ) : (
            <div className="oa-composer-input-row">
              <PromptInputTextarea
                placeholder="Type your message here..."
                onKeyDown={handleKeyDown}
                className="oa-composer-input"
                rows={1}
                data-oa-composer-input="true"
              />
            </div>
          )}
          {voiceError && <span className="sr-only" role="alert">{voiceError}</span>}
          <div className="oa-composer-action-row">
            <PromptInputActions className="oa-composer-actions">
              <PromptInputAction tooltip="Request a file">
                <button
                  type="button"
                  onClick={startFileRequest}
                  className="oa-composer-icon"
                  aria-label="Start file request"
                  aria-pressed={composerMode === "file_request"}
                >
                  <Paperclip className="h-5 w-5" />
                </button>
              </PromptInputAction>
              <ComposerDivider />
              <PromptInputAction tooltip="Open command bar">
                <button
                  type="button"
                  onClick={openCommandPalette}
                  className="oa-composer-icon"
                  aria-label="Open command bar"
                >
                  <Command className="h-5 w-5" />
                </button>
              </PromptInputAction>
              <ComposerDivider />
              <Popover.Root open={emojiPickerOpen} onOpenChange={setEmojiPickerOpen}>
                <PromptInputAction tooltip="Emoji">
                  <Popover.Trigger asChild>
                    <button type="button" className="oa-composer-icon" aria-label="Insert emoji" aria-pressed={emojiPickerOpen}>
                      <Smile className="h-5 w-5" />
                    </button>
                  </Popover.Trigger>
                </PromptInputAction>
                <Popover.Portal>
                  <Popover.Content
                    side="top"
                    align="end"
                    sideOffset={10}
                    className="oa-emoji-popover oa-composer-emoji-popover"
                  >
                    <div className="oa-emoji-picker-shell">
                      <EmojiPicker
                        theme={Theme.DARK}
                        lazyLoadEmojis
                        width={320}
                        height={380}
                        previewConfig={{ showPreview: false }}
                        onEmojiClick={(emojiData) => insertEmoji(emojiData.emoji)}
                      />
                    </div>
                  </Popover.Content>
                </Popover.Portal>
              </Popover.Root>
            </PromptInputActions>
            <PromptInputActions className="oa-composer-actions">
              <PromptInputAction tooltip={primaryActionTooltip}>
                <button
                  type="button"
                  onClick={handlePrimaryAction}
                  disabled={disabled || voiceState === "starting" || voiceState === "transcribing" || voiceState === "processing" || (!hasText && voiceState === "error" && !canStartVoice)}
                  className="oa-composer-send oa-composer-primary-action"
                  aria-label={primaryActionLabel}
                >
                  <PrimaryActionIcon className={voiceState === "starting" || voiceState === "processing" ? `${primaryActionIconClass} animate-spin` : primaryActionIconClass} />
                </button>
              </PromptInputAction>
            </PromptInputActions>
          </div>
        </PromptInput>
        {voiceError && (
          <div className="oa-composer-voice-error" aria-hidden="true">
            {voiceError}
          </div>
        )}
      </div>
    </div>
  );
}
