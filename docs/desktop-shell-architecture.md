# Desktop Shell Architecture

The desktop shell is a Tauri v2 packaging skeleton under `apps/desktop-shell/`. It hosts the existing Agentic Chat UI and provides the first process-management boundary for local sidecars. It is not a signed production installer.

## Shell Lifecycle

- Development loads the Vite chat UI from `http://127.0.0.1:5173` through `npm run dev:desktop`.
- Build mode runs the existing root `npm run build` and loads generated assets from `public/`.
- The shell owns desktop concerns only: window, tray, health checks, and sidecar placeholders.
- The React chat UI remains in `ui/`; `public/` remains generated output and must not be hand-edited.

## Sidecar Strategy

Tauri sidecars will use `bundle.externalBin` when real packaged binaries exist. The current skeleton keeps `externalBin` empty so builds do not fail on missing binaries.

Expected future binary names follow Tauri target triple rules:

- `local-agent-x86_64-pc-windows-msvc.exe`
- `notification-bridge-x86_64-pc-windows-msvc.exe`
- `quick-voice-x86_64-pc-windows-msvc.exe`

Development launch commands are fixed in the Tauri capability allowlist:

- `dev-local-agent`: `npm.cmd --prefix ../.. run dev:agent`
- `dev-notification-bridge`: `npm.cmd --prefix ../.. run dev:notification-bridge`
- `dev-quick-voice`: `npm.cmd --prefix ../.. run tauri:voice-dev`

Do not execute arbitrary shell commands. Do not add broad argument validators. Each sidecar action must map to a named, fixed command.

## Tray And Health

Tray menu placeholders:

- Open Oracle Amigo
- Agent status
- Restart local agent
- Open logs
- Quit

`Agent status` checks `http://127.0.0.1:<agent-port>/health`. The port comes from `AGENTIC_AGENT_PORT`, then `SANDBOX_PORT`, then default `3399`. Missing or stopped agents return `unreachable` or `down`; the desktop shell must not crash when the local agent is absent.

## Local Data Layout

Windows profile data lives under:

```text
%LOCALAPPDATA%/OracleAmigo/profiles/<profile>/
  agent.db
  storage/
  logs/
  config.json
```

Runtime config and user data belong here, not in packaged resources.

Do not bundle secrets. Do not package `.env` files, bearer tokens, authorization headers, GitHub tokens, npm tokens, private keys, or profile databases into the desktop shell or sidecar binaries.

## Packaging Status

This skeleton can compile where Tauri prerequisites are installed. It does not claim production signing, verified auto-update, store distribution, installer hardening, start-at-login behavior, or migration-safe profile management.
