import { useCallback, useMemo, useSyncExternalStore } from "react";

export const MESSAGE_THREADS_KEY = "oa-message-threads-v1";

export interface ThreadReply {
  id: string;
  text: string;
  timestamp: string;
  sender: "you" | "agent";
}

type ThreadMap = Record<string, ThreadReply[]>;

const listeners = new Set<() => void>();

function storageAvailable(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function isThreadReply(value: unknown): value is ThreadReply {
  if (!value || typeof value !== "object") return false;
  const reply = value as Partial<ThreadReply>;
  return (
    typeof reply.id === "string" &&
    typeof reply.text === "string" &&
    typeof reply.timestamp === "string" &&
    (reply.sender === "you" || reply.sender === "agent")
  );
}

function parseSnapshot(snapshot: string): ThreadMap {
  try {
    const parsed = JSON.parse(snapshot) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const map: ThreadMap = {};
    for (const [messageId, replies] of Object.entries(parsed)) {
      if (Array.isArray(replies)) map[messageId] = replies.filter(isThreadReply);
    }
    return map;
  } catch {
    return {};
  }
}

function readSnapshot(): string {
  if (!storageAvailable()) return "{}";
  return window.localStorage.getItem(MESSAGE_THREADS_KEY) ?? "{}";
}

function writeMap(map: ThreadMap): void {
  if (!storageAvailable()) return;
  window.localStorage.setItem(MESSAGE_THREADS_KEY, JSON.stringify(map));
  for (const listener of listeners) listener();
}

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
    const next = parseSnapshot(readSnapshot());
    const reply: ThreadReply = {
      id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      text: trimmed,
      timestamp: new Date().toISOString(),
      sender: "you",
    };
    next[messageId] = [...(next[messageId] ?? []), reply];
    writeMap(next);
  }, [messageId]);

  return { replies, addReply };
}
