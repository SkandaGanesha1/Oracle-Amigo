import { useCallback, useMemo, useSyncExternalStore } from "react";

export const MESSAGE_THREADS_KEY = "oa-message-threads-v1";

export interface ThreadReply {
  id: string;
  text: string;
  timestamp: string;
  sender: "you" | "agent";
  textPreview?: string;
}

type StoredThreadReply = Omit<ThreadReply, "text"> & { textPreview: string };
type StoredThreadMap = Record<string, StoredThreadReply[]>;
type ThreadMap = Record<string, ThreadReply[]>;

const listeners = new Set<() => void>();
const replyTextById = new Map<string, string>();
const REPLY_CONTENT_PLACEHOLDER = "[reply content not persisted]";

function storageAvailable(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function isStoredThreadReply(value: unknown): value is StoredThreadReply {
  if (!value || typeof value !== "object") return false;
  const reply = value as Partial<StoredThreadReply>;
  return (
    typeof reply.id === "string" &&
    typeof reply.timestamp === "string" &&
    (reply.sender === "you" || reply.sender === "agent") &&
    typeof reply.textPreview === "string"
  );
}

function sanitizeThreadStorage(value: unknown): StoredThreadMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const map: StoredThreadMap = {};
  for (const [messageId, replies] of Object.entries(value)) {
    if (!Array.isArray(replies)) continue;
    const sanitized = replies
      .map((item) => {
        const record = item as Partial<ThreadReply>;
        return {
          id: String(record.id ?? ""),
          timestamp: String(record.timestamp ?? new Date().toISOString()),
          sender: record.sender === "agent" ? "agent" as const : "you" as const,
          textPreview: typeof record.textPreview === "string" ? record.textPreview : REPLY_CONTENT_PLACEHOLDER,
        };
      })
      .filter(isStoredThreadReply);
    if (sanitized.length > 0) map[messageId] = sanitized;
  }
  return map;
}

function parseStoredSnapshot(snapshot: string): StoredThreadMap {
  try {
    return sanitizeThreadStorage(JSON.parse(snapshot) as unknown);
  } catch {
    return {};
  }
}

function parseSnapshot(snapshot: string): ThreadMap {
  const stored = parseStoredSnapshot(snapshot);
  const map: ThreadMap = {};
  for (const [messageId, replies] of Object.entries(stored)) {
    map[messageId] = replies.map((reply) => ({
      ...reply,
      text: replyTextById.get(reply.id) ?? REPLY_CONTENT_PLACEHOLDER,
    }));
  }
  return map;
}

function readSnapshot(): string {
  if (!storageAvailable()) return "{}";
  return window.localStorage.getItem(MESSAGE_THREADS_KEY) ?? "{}";
}

function migrateThreadStorage(): void {
  if (!storageAvailable()) return;
  try {
    const raw = window.localStorage.getItem(MESSAGE_THREADS_KEY);
    if (!raw) return;
    const sanitized = sanitizeThreadStorage(JSON.parse(raw) as unknown);
    const next = JSON.stringify(sanitized);
    if (raw !== next) window.localStorage.setItem(MESSAGE_THREADS_KEY, next);
  } catch {
    window.localStorage.removeItem(MESSAGE_THREADS_KEY);
  }
}

function writeMap(map: StoredThreadMap): void {
  if (!storageAvailable()) return;
  window.localStorage.setItem(MESSAGE_THREADS_KEY, JSON.stringify(map));
  for (const listener of listeners) listener();
}

migrateThreadStorage();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  function handleStorage(event: StorageEvent) {
    if (event.key === MESSAGE_THREADS_KEY) listener();
  }
  if (typeof window !== "undefined") window.addEventListener("storage", handleStorage);
  return () => {
    listeners.delete(listener);
    if (typeof window !== "undefined") window.removeEventListener("storage", handleStorage);
  };
}

export function useMessageThread(messageId?: string) {
  const snapshot = useSyncExternalStore(subscribe, readSnapshot, () => "{}");
  const map = useMemo(() => parseSnapshot(snapshot), [snapshot]);
  const replies = useMemo(() => (messageId ? map[messageId] ?? [] : []), [map, messageId]);

  const addReply = useCallback((text: string) => {
    if (!messageId) return;
    const trimmed = text.trim();
    if (!trimmed) return;
    const next = parseStoredSnapshot(readSnapshot());
    const id = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    replyTextById.set(id, trimmed);
    const reply: ThreadReply = {
      id,
      text: trimmed,
      timestamp: new Date().toISOString(),
      sender: "you",
      textPreview: REPLY_CONTENT_PLACEHOLDER,
    };
    next[messageId] = [
      ...(next[messageId] ?? []),
      {
        id: reply.id,
        timestamp: reply.timestamp,
        sender: reply.sender,
        textPreview: reply.textPreview ?? REPLY_CONTENT_PLACEHOLDER,
      },
    ];
    writeMap(next);
  }, [messageId]);

  return { replies, addReply };
}
