import { useState, useCallback, useRef, useMemo } from "react";
import { PromptInput, PromptInputTextarea, PromptInputActions, PromptInputAction } from "~/components/ui/prompt-input";
import { ArrowUp, Paperclip, Command, User } from "lucide-react";
import { FileRequestIntentChip, matchFileRequestIntent } from "../../features/chat/FileRequestIntentChip";
import { AttachmentPreview } from "./AttachmentPreview";
import { HuddleButton } from "../chat/HuddleButton";
import { SuggestedPrompts } from "../chat/SuggestedPrompts";
import type { SuggestedPrompt } from "../../types";

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

const DEFAULT_SUGGESTED_PROMPTS: SuggestedPrompt[] = [
  { text: "Show what data would leave this device", category: "approval", confidence: 0.86 },
  { text: "Summarize this mission with risks", category: "mission", confidence: 0.82 },
  { text: "Find the exact file and ask before sending", category: "search", confidence: 0.8 }
];

export function MessageComposer({ conversationId, onSend, disabled, availableAgents }: MessageComposerProps) {
  const [text, setText] = useState("");
  const [showCommands, setShowCommands] = useState(false);
  const [commandIndex, setCommandIndex] = useState(0);
  const [showMentions, setShowMentions] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionIndex, setMentionIndex] = useState(0);
  const [attachment, setAttachment] = useState<{ name: string; size: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isFileRequest = matchFileRequestIntent(text);

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
    const sendAs = isFileRequest ? "file_request" : "normal";
    void onSend(text.trim(), sendAs);
    setText("");
    setShowCommands(false);
    setShowMentions(false);
  }, [text, disabled, isFileRequest, onSend]);

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

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      setAttachment({ name: file.name, size: file.size });
    }
  }

  function openCommandPalette() {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }));
  }

  function insertSuggestedPrompt(prompt: string) {
    setText(prompt);
  }

  return (
    <div className="density-composer glass-panel flex flex-col gap-2 border-t border-oa-border px-4 py-3">
      <SuggestedPrompts prompts={DEFAULT_SUGGESTED_PROMPTS} onSelect={insertSuggestedPrompt} />

      {isFileRequest && (
        <div className="flex items-center gap-2 px-1">
          <FileRequestIntentChip visible={true} />
          <span className="text-[10px] text-oa-text-muted">Message will be sent as a file request to the agent</span>
        </div>
      )}

      {attachment && (
        <AttachmentPreview
          fileName={attachment.name}
          fileSize={attachment.size}
          onRemove={() => setAttachment(null)}
        />
      )}

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
        className="rounded-2xl border-oa-border bg-oa-bg-elevated/90 shadow-lg shadow-black/10 focus-within:border-oa-blue/70 focus-within:ring-2 focus-within:ring-oa-blue/20"
      >
        {showCommands && filteredCommands.length > 0 && (
          <div className="mb-2 overflow-hidden rounded-lg border border-oa-border bg-oa-surface-2">
            {filteredCommands.map((cmd, i) => (
              <button
                key={cmd.command}
                type="button"
                role="option"
                aria-selected={i === commandIndex}
                className={`flex min-h-[48px] w-full items-center gap-3 px-3 py-2 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-oa-blue ${
                  i === commandIndex ? "bg-oa-blue/20 text-oa-blue" : "text-oa-text hover:bg-oa-surface"
                }`}
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
          <div className="mb-2 overflow-hidden rounded-lg border border-oa-border bg-oa-surface-2 shadow-lg" role="listbox" aria-label="Agent mentions">
            {filteredMentions.map((agent, i) => (
              <button
                key={agent.id}
                type="button"
                role="option"
                aria-selected={i === mentionIndex}
                className={`flex min-h-[48px] w-full items-center gap-3 px-3 py-2 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-oa-blue ${
                  i === mentionIndex ? "bg-oa-blue/20 text-oa-blue" : "text-oa-text hover:bg-oa-surface"
                }`}
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

        <div className="flex items-end gap-2">
          <PromptInputTextarea
            placeholder="Type a message or / for commands... @ to mention"
            onKeyDown={handleKeyDown}
            className="min-h-[44px] text-sm text-oa-text placeholder:text-oa-text-disabled"
            rows={1}
          />
          <PromptInputActions className="flex items-center gap-1 rounded-xl border border-oa-border bg-oa-surface/80 p-1">
            <PromptInputAction tooltip="Open command bar">
              <button
                type="button"
                onClick={openCommandPalette}
                className="flex min-h-[48px] min-w-[48px] items-center justify-center rounded-lg text-oa-text-muted transition-colors hover:bg-oa-surface hover:text-oa-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue focus-visible:ring-offset-2"
                aria-label="Open command bar"
              >
                <Command className="h-4 w-4" />
              </button>
            </PromptInputAction>
            <PromptInputAction tooltip="Start huddle">
              <HuddleButton />
            </PromptInputAction>
            <PromptInputAction tooltip="Attach file">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex min-h-[48px] min-w-[48px] items-center justify-center rounded-lg text-oa-text-muted transition-colors hover:bg-oa-surface hover:text-oa-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue focus-visible:ring-offset-2"
                aria-label="Attach file"
              >
                <Paperclip className="h-4 w-4" />
              </button>
            </PromptInputAction>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={handleFileSelect}
            />
            <PromptInputAction tooltip="Send message">
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!text.trim() || disabled}
                className="flex min-h-[48px] min-w-[48px] items-center justify-center rounded-lg bg-oa-blue text-white transition-colors hover:bg-oa-blue/80 disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue focus-visible:ring-offset-2"
                aria-label="Send message"
              >
                <ArrowUp className="h-4 w-4" />
              </button>
            </PromptInputAction>
          </PromptInputActions>
        </div>
      </PromptInput>
    </div>
  );
}
