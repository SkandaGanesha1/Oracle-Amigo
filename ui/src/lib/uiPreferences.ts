import { useSyncExternalStore } from "react";

export type UiDensity = "compact" | "comfortable";

export const UI_DENSITY_KEY = "oa-ui-density-v1";

const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function readDensity(): UiDensity {
  if (typeof window === "undefined") return "comfortable";
  return window.localStorage.getItem(UI_DENSITY_KEY) === "compact" ? "compact" : "comfortable";
}

function getSnapshot() {
  return readDensity();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

export function setDensityPreference(density: UiDensity) {
  window.localStorage.setItem(UI_DENSITY_KEY, density);
  emit();
}

export function useDensityPreference() {
  const density = useSyncExternalStore(subscribe, getSnapshot, () => "comfortable" as UiDensity);
  return { density, setDensity: setDensityPreference };
}
