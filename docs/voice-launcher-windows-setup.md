# Quick Voice Windows Setup

Quick Voice is a Tauri desktop app, so `tauri dev` and native rebuilds require Rust/Cargo in addition to Node.js.

If PowerShell shows:

```text
failed to run 'cargo metadata'
program not found
```

install Rust with rustup:

```powershell
winget install Rustlang.Rustup
```

Then close every PowerShell and VS Code terminal and open a new one so `%USERPROFILE%\.cargo\bin` is on `PATH`.

Verify:

```powershell
cargo --version
rustc --version
```

Run the launcher in development:

```powershell
npm --prefix apps/voice-launcher run tauri:dev
```

Build the release executable:

```powershell
npm --prefix apps/voice-launcher run tauri:build
```
