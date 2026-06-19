# Installer Roadmap

This document tracks the path from "works on the developer's machine" to "ships as a one-click installer for non-technical users." Each phase has a clear exit criterion and a small set of tasks.

## Current State (Phase 0)

- Source-only distribution. Users need Node.js 20+, run `npm install`, and start the agent manually.
- Configuration is via `.env` files.
- The Windows notification bridge is a separate C# program the user must compile and register themselves.
- Desktop Shell Skeleton exists as the first Tauri v2 packaging boundary for the Agentic Chat UI, tray placeholders, local health checks, and sidecar placeholders. No production signing claim.

The two-laptop demo runs but the setup takes 20+ minutes and requires the user to be comfortable with command-line tools.

## Phase 0.5: Desktop Shell Skeleton

**Exit criterion:** Developers can run a Tauri desktop shell that hosts the built Agentic Chat UI and exposes placeholder management hooks for local sidecars.

| Task | Status |
| --- | --- |
| Create `apps/desktop-shell/` Tauri v2 shell | Done |
| Load chat UI from Vite in dev and `public/` in build mode | Done |
| Add tray placeholders for open/status/restart/logs/quit | Done |
| Add graceful local-agent health check for `/health` | Done |
| Document `externalBin` sidecar strategy and placeholder binaries folder | Done |
| Keep secrets and profile data out of bundled resources | Done |
| Add static shell configuration tests and Rust health-check test | Done |
| Replace placeholder sidecars with real packaged binaries | Next |
| Add process supervision, restart policy, and log routing | Next |
| Implement native SecretStore backends for Windows Credential Manager/DPAPI and macOS Keychain | Next |
| Add start-at-login controls | Next |
| Add signed Windows installer and update channel | Next |

## Phase A: Packaged Local Agent (Windows / macOS / Linux)

**Exit criterion:** A user can double-click an installer, grant the requested permissions, and have a working local agent on their machine.

| Task | Status |
| --- | --- |
| Bundle the Node.js agent + sqlite-vec native extension as a single executable (using `pkg` or `bun build --compile`) | TBD |
| Replace development `SECRET_STORE=file` with native credential storage for cloud tokens and local private keys | TBD |
| Code-sign the binary (Windows: Authenticode, macOS: Developer ID, Linux: GPG) | TBD |
| Create platform-specific installers (Windows: MSI/EXE via WiX or NSIS, macOS: DMG/PKG, Linux: AppImage/deb/rpm) | TBD |
| Ship a "Start at login" hook on each platform | TBD |
| Bundle the local UI assets (HTML/JS) inside the executable | TBD |

## Phase B: Installer for the Windows Notification Bridge

**Exit criterion:** The notification bridge installs itself when the local agent starts (no user action required).

| Task | Status |
| --- | --- |
| Embed the bridge as a child process spawned by the local agent | TBD |
| Auto-register the AUMID with the Windows shell on first launch | TBD |
| Add a "Notification bridge is ready" indicator to the local UI status bar | TBD |

## Phase C: Control Plane Deployment

**Exit criterion:** A new instance of the control plane can be stood up via `docker compose up` with a single command.

| Task | Status |
| --- | --- |
| Write a multi-stage `Dockerfile` for the control plane (build stage + runtime stage) | TBD |
| Provide a `docker-compose.yml` with the control plane + a reverse proxy + (optional) Postgres | TBD |
| Helm chart for Kubernetes deployment (with HPA, PVC for SQLite/Postgres, ingress, TLS) | TBD |
| Document the production secrets management (where to put `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, admin secrets, and local `SECRET_STORE` requirements) | TBD |

## Phase D: Auto-Update Channel

**Exit criterion:** The local agent checks for updates on launch and rolls forward without user action.

| Task | Status |
| --- | --- |
| Sign release artifacts with a project-controlled key | TBD |
| Add a `versionCheck` endpoint to the control plane (or a dedicated update service) | TBD |
| Implement staged rollout: opt-in beta channel + stable channel | TBD |
| Document the rollback procedure (the agent must be able to downgrade to the previous version without losing data) | TBD |

## Phase E: First-Run Onboarding

**Exit criterion:** A new user goes from "installed" to "first cross-device A2A v1 message sent" in under 5 minutes, with no documentation.

| Task | Status |
| --- | --- |
| A welcome screen in the local UI that walks through: account creation → device enrollment → friend invitation → first message | TBD |
| Optional: sign in with Google/Apple (delegated auth instead of email+password) | TBD |
| In-app tutorial that drops a test message onto a friend device | TBD |
| Localized strings (en, es, fr, de, ja, zh-CN as the first set) | TBD |

## Phase F: Operational Tooling

**Exit criterion:** A small operations team can run the control plane in production without paging the developers.

| Task | Status |
| --- | --- |
| Structured logging (pino) with correlation IDs that flow from the agent → relay → control plane | TBD |
| Prometheus metrics endpoint on the control plane (`/metrics`) | Done |
| Alerting runbook: "what to do when X happens" for the top 10 alert types | TBD |
| Database backup automation (encrypted, offsite, tested restore) | TBD |

## Phase G: Distribution Channels

**Exit criterion:** The agent is discoverable in the standard app stores.

| Channel | Notes |
| --- | --- |
| Microsoft Store | Requires MSIX packaging + store certification |
| Apple App Store | Sandboxing constraints may force the local agent to live in a privileged helper tool |
| Snap / Flatpak | Linux distribution |
| Homebrew | macOS / Linux CLI distribution |

## Out of Scope (for the v1 launch)

- Mobile clients (iOS / Android native or React Native)
- Web-based agent control panel (the local UI is a packaged desktop app)
- Federated control plane (each org runs its own)
- End-to-end encryption of all A2A messages (currently E2E for ANP handshakes; relay messages are TLS-in-transit only)

## Sequencing

The phases above are roughly in priority order. Phase A is the highest leverage (it unblocks the rest of the roadmap), Phase G is the lowest (it only matters once we have a polished product to distribute).

Each phase has its own design doc and acceptance criteria; do not start a phase until the previous one is complete and reviewed.
