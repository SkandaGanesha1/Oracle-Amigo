import EmojiPicker, { Theme } from "emoji-picker-react";
import { useState, useCallback, useMemo } from "react";
import { PromptInput, PromptInputTextarea, PromptInputActions, PromptInputAction } from "~/components/ui/prompt-input";
import { ArrowUp, Command, FileSearch, User, Smile } from "lucide-react";
import { Popover } from "radix-ui";
import { FileRequestIntentChip, matchFileRequestIntent } from "../../features/chat/FileRequestIntentChip";
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
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);

  const isFileRequest = matchFileRequestIntent(text);
  const composerMode = isFileRequest ? "file_request" : "normal";

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
      if (emojiPickerOpen) {
        e.preventDefault();
        setEmojiPickerOpen(false);
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

  function insertSuggestedPrompt(prompt: string) {
    setText(prompt);
  }

  function insertEmoji(emoji: string) {
    setText((current) => `${current}${emoji}`);
    setEmojiPickerOpen(false);
  }

  return (
    <div className="oa-composer-dock density-composer">
      <div className="oa-composer-quick-actions">
        <SuggestedPrompts prompts={DEFAULT_SUGGESTED_PROMPTS} onSelect={insertSuggestedPrompt} />
      </div>

      {composerMode === "file_request" && (
        <div className="oa-composer-mode-row">
          <FileRequestIntentChip visible={true} />
          <span>Send file request? The agent must ask before any file leaves this device.</span>
        </div>
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
        className="oa-composer-frame"
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
            className="oa-composer-input"
            rows={1}
            data-oa-composer-input="true"
          />
          <PromptInputActions className="oa-composer-actions">
            <PromptInputAction tooltip="Request a file">
              <button
                type="button"
                onClick={startFileRequest}
                className="oa-composer-icon"
                aria-label="Start file request"
                aria-pressed={composerMode === "file_request"}
              >
                <FileSearch className="h-4 w-4" />
              </button>
            </PromptInputAction>
            <PromptInputAction tooltip="Open command bar">
              <button
                type="button"
                onClick={openCommandPalette}
                className="oa-composer-icon"
                aria-label="Open command bar"
              >
                <Command className="h-4 w-4" />
              </button>
            </PromptInputAction>
            <Popover.Root open={emojiPickerOpen} onOpenChange={setEmojiPickerOpen}>
              <PromptInputAction tooltip="Emoji">
                <Popover.Trigger asChild>
                  <button type="button" className="oa-composer-icon" aria-label="Insert emoji" aria-pressed={emojiPickerOpen}>
                    <Smile className="h-4 w-4" />
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
            <PromptInputAction tooltip="Send message">
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!text.trim() || disabled}
                className="oa-composer-send"
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
