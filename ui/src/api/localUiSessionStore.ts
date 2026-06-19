import { useSyncExternalStore } from "react";

export type LocalUiSessionStatus = "checking" | "ready" | "recovering" | "blocked";

export interface LocalUiSessionSnapshot {
  status: LocalUiSessionStatus;
  message: string | null;
}

const listeners = new Set<() => void>();
let snapshot: LocalUiSessionSnapshot = { status: "checking", message: null };

function emit(): void {
  for (const listener of listeners) listener();
}

function setSnapshot(next: LocalUiSessionSnapshot): void {
  if (snapshot.status === next.status && snapshot.message === next.message) return;
  snapshot = next;
  emit();
}

export function getLocalUiSessionSnapshot(): LocalUiSessionSnapshot {
  return snapshot;
}

export function subscribeLocalUiSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useLocalUiSession(): LocalUiSessionSnapshot {
  return useSyncExternalStore(subscribeLocalUiSession, getLocalUiSessionSnapshot, getLocalUiSessionSnapshot);
}

export function isLocalUiSessionReady(status = snapshot.status): boolean {
  return status === "ready";
}

export function markLocalUiSessionChecking(): void {
  setSnapshot({ status: "checking", message: null });
}

export function markLocalUiSessionRecovering(): void {
  setSnapshot({ status: "recovering", message: "Refreshing local UI session..." });
}

export function markLocalUiSessionReady(): void {
  setSnapshot({ status: "ready", message: null });
}

export function markLocalUiSessionBlocked(message = "Local UI session expired. Refresh the session to continue."): void {
  setSnapshot({ status: "blocked", message });
}

export async function bootstrapLocalUiSession(): Promise<boolean> {
  if (snapshot.status !== "ready") markLocalUiSessionChecking();
  try {
    const response = await fetch("/local-ui-session", { credentials: "include" });
    if (!response.ok) {
      markLocalUiSessionBlocked(`Local UI session refresh failed with HTTP ${response.status}.`);
      return false;
    }
    await readBootstrapResponse(response);
    markLocalUiSessionReady();
    return true;
  } catch (error) {
    markLocalUiSessionBlocked(error instanceof Error ? error.message : "Local UI session refresh failed.");
    return false;
  }
}

export function resetLocalUiSessionForTests(): void {
  snapshot = { status: "checking", message: null };
  listeners.clear();
}

async function readBootstrapResponse(response: Response): Promise<void> {
  try {
    await response.text();
  } catch {
    // The Set-Cookie side effect is what matters here.
  }
}
