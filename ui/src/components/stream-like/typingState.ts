import { useEffect, useSyncExternalStore } from "react";

export interface TypingState {
  conversationId: string;
  actorId: string;
  actorLabel: string;
  expiresAt: number;
}

export const TYPING_TTL_MS = 6000;

const typingStates = new Map<string, TypingState>();
const listeners = new Set<() => void>();

function typingKey(conversationId: string, actorId: string): string {
  return `${conversationId}:${actorId}`;
}

function emitTypingChange(): void {
  for (const listener of listeners) listener();
}

export function setTypingState(state: TypingState): void {
  typingStates.set(typingKey(state.conversationId, state.actorId), state);
  emitTypingChange();
}

export function removeExpiredTypingStates(now = Date.now()): void {
  let changed = false;
  for (const [key, state] of typingStates) {
    if (state.expiresAt <= now) {
      typingStates.delete(key);
      changed = true;
    }
  }
  if (changed) emitTypingChange();
}

function subscribeTyping(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function typingSnapshot(): string {
  return JSON.stringify(Array.from(typingStates.values()).sort((a, b) =>
    a.conversationId.localeCompare(b.conversationId) ||
    a.actorId.localeCompare(b.actorId)
  ));
}

function serverTypingSnapshot(): string {
  return "[]";
}

export function useTypingStates(conversationId: string | null | undefined): TypingState[] {
  const snapshot = useSyncExternalStore(subscribeTyping, typingSnapshot, serverTypingSnapshot);

  useEffect(() => {
    const timer = window.setInterval(() => {
      removeExpiredTypingStates(Date.now());
    }, 1000);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    function handleTypingStart(event: Event) {
      const detail = (event as CustomEvent<Partial<TypingState>>).detail;
      if (!detail?.conversationId || !detail.actorId) return;
      setTypingState({
        conversationId: detail.conversationId,
        actorId: detail.actorId,
        actorLabel: detail.actorLabel ?? "Someone",
        expiresAt: Date.now() + TYPING_TTL_MS,
      });
    }

    window.addEventListener("oa-typing-start", handleTypingStart);
    return () => window.removeEventListener("oa-typing-start", handleTypingStart);
  }, []);

  try {
    const states = JSON.parse(snapshot) as TypingState[];
    return states.filter((state) => state.conversationId === conversationId);
  } catch {
    return [];
  }
}
