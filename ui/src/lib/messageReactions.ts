import { useCallback, useMemo, useSyncExternalStore } from "react";

export const MESSAGE_REACTIONS_KEY = "oa-message-reactions-v1";

type ReactionMap = Record<string, string[]>;

const listeners = new Set<() => void>();
const LEGACY_REACTION_MAP: Record<string, string> = {
  like: "👍",
  love: "❤️",
  smile: "😀",
  celebrate: "🎉"
};

function storageAvailable(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function parseSnapshot(snapshot: string): ReactionMap {
  try {
    const parsed = JSON.parse(snapshot) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const map: ReactionMap = {};
    for (const [messageId, reactions] of Object.entries(parsed)) {
      if (Array.isArray(reactions)) {
        const normalized = reactions
          .filter((reaction): reaction is string => typeof reaction === "string")
          .map((reaction) => LEGACY_REACTION_MAP[reaction] ?? reaction)
          .filter((reaction) => reaction.trim().length > 0);
        map[messageId] = Array.from(new Set(normalized));
      }
    }
    return map;
  } catch {
    return {};
  }
}

function readSnapshot(): string {
  if (!storageAvailable()) return "{}";
  return window.localStorage.getItem(MESSAGE_REACTIONS_KEY) ?? "{}";
}

function writeMap(map: ReactionMap): void {
  if (!storageAvailable()) return;
  window.localStorage.setItem(MESSAGE_REACTIONS_KEY, JSON.stringify(map));
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  function handleStorage(event: StorageEvent) {
    if (event.key === MESSAGE_REACTIONS_KEY) listener();
  }
  if (typeof window !== "undefined") window.addEventListener("storage", handleStorage);
  return () => {
    listeners.delete(listener);
    if (typeof window !== "undefined") window.removeEventListener("storage", handleStorage);
  };
}

export function useMessageReactions(messageId?: string) {
  const snapshot = useSyncExternalStore(subscribe, readSnapshot, () => "{}");
  const map = useMemo(() => parseSnapshot(snapshot), [snapshot]);
  const reactions = useMemo(() => new Set(messageId ? map[messageId] ?? [] : []), [map, messageId]);

  const toggleReaction = useCallback((reactionId: string) => {
    if (!messageId) return;
    const next = parseSnapshot(readSnapshot());
    const current = new Set(next[messageId] ?? []);
    if (current.has(reactionId)) current.delete(reactionId);
    else current.add(reactionId);
    if (current.size === 0) delete next[messageId];
    else next[messageId] = Array.from(current);
    writeMap(next);
  }, [messageId]);

  const setReaction = useCallback((reactionId: string, active: boolean) => {
    if (!messageId) return;
    const next = parseSnapshot(readSnapshot());
    const current = new Set(next[messageId] ?? []);
    if (active) current.add(reactionId);
    else current.delete(reactionId);
    if (current.size === 0) delete next[messageId];
    else next[messageId] = Array.from(current);
    writeMap(next);
  }, [messageId]);

  return { reactions, toggleReaction, setReaction };
}
