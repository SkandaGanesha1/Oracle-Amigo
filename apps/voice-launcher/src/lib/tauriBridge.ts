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
      globalShortcut?: {
        register?: (shortcut: string, handler: () => void) => Promise<void>;
        unregister?: (shortcut: string) => Promise<void>;
      };
      window?: {
        getCurrentWindow?: () => {
          show: () => Promise<void>;
          hide: () => Promise<void>;
          setFocus: () => Promise<void>;
        };
      };
    };
  }
}

export async function registerLauncherShortcut(onOpen: () => void): Promise<void> {
  if (getConfiguredShortcut() === "Ctrl+Space") return;
  const shortcut = toTauriShortcut(getConfiguredShortcut());
  const register = window.__TAURI__?.globalShortcut?.register;
  if (!register) return;
  await register(shortcut, onOpen);
}

export async function updateLauncherShortcut(nextShortcut: string, onOpen: () => void): Promise<void> {
  const previousShortcut = toTauriShortcut(getConfiguredShortcut());
  localStorage.setItem("oa-voice-shortcut-v1", nextShortcut);
  const globalShortcut = window.__TAURI__?.globalShortcut;
  if (!globalShortcut?.register) return;
  const shortcut = toTauriShortcut(nextShortcut);
  if (globalShortcut.unregister && previousShortcut !== nextShortcut) {
    await globalShortcut.unregister(previousShortcut).catch(() => undefined);
  }
  await globalShortcut.register(shortcut, onOpen);
}

export function getConfiguredShortcut(): string {
  return localStorage.getItem("oa-voice-shortcut-v1") || "Ctrl+Space";
}

function toTauriShortcut(shortcut: string): string {
  return shortcut
    .replace(/^Ctrl\+/i, "CommandOrControl+")
    .replace(/\+Ctrl\+/i, "+CommandOrControl+");
}

export async function hideLauncherWindow(): Promise<void> {
  const win = window.__TAURI__?.window?.getCurrentWindow?.();
  await win?.hide();
}

export async function showLauncherWindow(): Promise<void> {
  const win = window.__TAURI__?.window?.getCurrentWindow?.();
  await win?.show();
  await win?.setFocus();
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

function isAddressInUse(value: string): boolean {
  return /EADDRINUSE|address already in use/i.test(value);
}
