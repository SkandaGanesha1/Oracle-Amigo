# Desktop Shell Sidecar Binaries

This folder is intentionally a placeholder for the first desktop-shell packaging skeleton.

Future production bundles should place compiled sidecars here using Tauri's `bundle.externalBin`
target triple naming convention:

- `local-agent-x86_64-pc-windows-msvc.exe`
- `notification-bridge-x86_64-pc-windows-msvc.exe`
- `quick-voice-x86_64-pc-windows-msvc.exe`

Add macOS and Linux target triple binaries only when those platforms have real packaging support.

Do not bundle secrets, `.env` files, access tokens, private keys, npm tokens, GitHub tokens, or user
profile data in this directory. Sidecars must load runtime configuration from the per-profile data
directory, not from packaged resources.

The current Tauri config keeps `bundle.externalBin` empty so skeleton builds do not fail because
these binaries do not exist yet.
