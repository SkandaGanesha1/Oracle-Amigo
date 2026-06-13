import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

declare global {
  interface Window {
    __TAURI__?: {
      shell?: {
        Command?: {
          create: (name: string, args?: string[], options?: Record<string, unknown>) => {
            execute: () => Promise<{ code: number; stdout: string; stderr: string }>;
            spawn?: () => Promise<unknown>;
          };
        };
      };
    };
  }
}

interface VoiceShortcutHandlers {
  onStart: () => void;
  onStop: () => void;
}

export async function listenToVoiceShortcutEvents(handlers: VoiceShortcutHandlers): Promise<() => void> {
  if (!isTauriRuntime()) return () => undefined;
  const unlistenStart = await listen("voice:start", handlers.onStart);
  const unlistenStop = await listen("voice:stop-and-submit", handlers.onStop);
  return () => {
    unlistenStart();
    unlistenStop();
  };
}

export async function hideLauncherWindow(): Promise<void> {
  if (!isTauriRuntime()) return;
  await getCurrentWindow().hide();
}

export async function showLauncherWindow(): Promise<void> {
  if (!isTauriRuntime()) return;
  try {
    await invoke("show_voice_window");
  } catch {
    const win = getCurrentWindow();
    await win.show();
    await win.setFocus();
  }
}

export async function startLocalAgentSidecar(): Promise<void> {
  const command = window.__TAURI__?.shell?.Command?.create;
  if (!command) throw new Error("Tauri shell plugin is not available.");
  const runner = command("start-local-agent-dev");
  if (runner.spawn) {
    await runner.spawn();
    return;
  }
  const result = await runner.execute();
  if (result.code !== 0) {
    if (isAddressInUse(result.stderr) || isAddressInUse(result.stdout)) return;
    throw new Error(result.stderr || "Local agent startup command failed.");
  }
}

function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window || "__TAURI__" in window;
}

function isAddressInUse(value: string): boolean {
  return /EADDRINUSE|address already in use/i.test(value);
}
