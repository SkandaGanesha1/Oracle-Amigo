# Voice Launcher Windows Setup

## Development

Start the local agent:

```powershell
npm.cmd run dev
```

Start the launcher web shell:

```powershell
npm.cmd run dev:voice-launcher
```

Build the launcher frontend:

```powershell
npm.cmd run build:voice-launcher
```

## Tauri Native Build

Tauri native packaging requires Rust/Cargo and the Tauri CLI dependencies in `apps/voice-launcher`.

Install the nested launcher dependencies:

```powershell
npm.cmd install --prefix apps/voice-launcher
```

Then run:

```powershell
npm.cmd run tauri:voice-build
```

If this fails with `cargo metadata` or `program not found`, install Rust and rerun the command.

## Local Agent URL

The launcher defaults to:

```text
http://127.0.0.1:3399
```

Override it with:

```powershell
$env:VITE_ORACLE_AMIGO_LOCAL_AGENT_URL = "http://127.0.0.1:3400"
npm.cmd run dev:voice-launcher
```

## Shortcut

Default shortcut: `Ctrl+Space`

Supported first-pass choices:

- `Ctrl+Space`
- `Ctrl+Shift+Space`
- `Alt+Space`
- `Alt+A`

The selected value is stored locally in the launcher via `oa-voice-shortcut-v1`.
