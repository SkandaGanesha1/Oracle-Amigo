import { useMemo, useSyncExternalStore } from "react";

const STORAGE_KEY = "oa-privacy-mode";
const listeners = new Set<() => void>();

function getStored(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function setStored(value: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, value ? "true" : "false");
  } catch {
    // localStorage unavailable
  }
  for (const listener of listeners) listener();
}

export function isPrivacyModeEnabled(): boolean {
  return getStored();
}

export function subscribePrivacyMode(callback: () => void): () => void {
  listeners.add(callback);
  return () => { listeners.delete(callback); };
}

export function getPrivacyModeSnapshot(): string {
  return getStored() ? "true" : "false";
}

export function getPrivacyModeServerSnapshot(): string {
  return "false";
}

export function setPrivacyMode(enabled: boolean): void {
  setStored(enabled);
}

export function togglePrivacyMode(): void {
  setStored(!getStored());
}

export function usePrivacyMode(): { value: boolean; set: (enabled: boolean) => void; toggle: () => void } {
  const enabled = useSyncExternalStore(subscribePrivacyMode, getPrivacyModeSnapshot, getPrivacyModeServerSnapshot) === "true";
  return useMemo(() => ({
    value: enabled,
    set: setPrivacyMode,
    toggle: togglePrivacyMode
  }), [enabled]);
}

export function maskFileName(name: string): string {
  if (!getStored()) return name;
  if (name.length <= 3) return "***";
  return name.slice(0, 1) + "*".repeat(Math.min(name.length - 2, 12)) + name.slice(-1);
}
