# Oracle Amigo Sandbox Tools

This project is a safe sandbox tool layer for a personal agent. The agent calls a controlled TypeScript API instead of raw shell or raw Gondolin SDK calls. The layer validates requests, applies command/network/secret policy, runs work inside one Gondolin micro-VM per session, and keeps a visible event log for every action.

## Architecture

```text
Personal Agent
  -> SandboxTool
  -> CommandPolicy / NetworkPolicy / SecretPolicy
  -> SandboxSessionManager
  -> GondolinSandbox
  -> Gondolin VM
```

Gondolin is the execution boundary. This project is the policy and observability layer around it.

## Quick Start

```bash
npm install
npm run typecheck
npm test
npm run demo:dry
npm run dev
```

PowerShell dry-run equivalent:

```powershell
$env:SANDBOX_DRY_RUN="true"; npm run demo
```

## Environment

Copy `.env.example` to `.env` and fill only the secrets you want host-scoped.

```text
SANDBOX_DRY_RUN=true
SANDBOX_HOST=127.0.0.1
SANDBOX_PORT=3399
GITHUB_TOKEN=
NPM_TOKEN=
```

Secrets are never returned to the agent. `GITHUB_TOKEN` is only scoped to `github.com` and `api.github.com`; `NPM_TOKEN` is only scoped to `registry.npmjs.org`.

## HTTP API

Start the local tool server:

```bash
npm run dev
```

Create a session:

```bash
curl -sS -X POST http://127.0.0.1:3399/sessions \
  -H "content-type: application/json" \
  -d '{"purpose":"test generated code","networkProfile":"npm"}'
```

Run a command:

```bash
curl -sS -X POST http://127.0.0.1:3399/sessions/<sessionId>/shell \
  -H "content-type: application/json" \
  -d '{"command":"node --version"}'
```

View session events:

```bash
curl -sS http://127.0.0.1:3399/sessions/<sessionId>/events
```

Close a session:

```bash
curl -sS -X DELETE http://127.0.0.1:3399/sessions/<sessionId>
```

Create a frontend-style agent run. By default this creates a Gondolin session, runs a small VM probe (`pwd`, `whoami`, `hostname`), then performs the host-side PDF search with every step labeled as either `gondolin-vm-command`, `host-file-search`, or `agent-orchestrator`.

```bash
curl -sS -X POST http://127.0.0.1:3399/agent/runs \
  -H "content-type: application/json" \
  -d '{"query":"find the Job Offer-Associate Consultant.pdf file"}'
```

The host file search is intentionally separate from the VM command execution because Windows files such as Downloads are not automatically visible inside an isolated Gondolin guest. The response includes the run id, sandbox session id when creation succeeds, command trace, matched directory, and PDF preview URL.

## Static UI

The browser UI is a React + Tailwind frontend built into `public/` and served by the same local tool server. The reusable AI prompt component lives at `components/ui/ai-prompt-box.tsx`; `public/` is generated output from `npm run build`.

Build the frontend and server output:

```bash
npm run build
```

Start it in dry-run mode when you want the browser flow to work without QEMU:

```bash
SANDBOX_DRY_RUN=true npm run dev
```

Then open:

```text
http://127.0.0.1:3399/
```

The UI loads `public/index.html` at `/` and serves Vite-generated assets through `/assets/*`. It shows the shader background and the reusable AI prompt box with Lucide icons, Radix tooltips/dialogs, Framer Motion interactions, image upload/preview, mode toggles, loading, and voice-recording states. Prompt submissions call `/agent/runs`, so the Agent Plan panel can show the run record, Gondolin session status, labeled VM commands, labeled host file search commands, the found directory, and the PDF preview.

PowerShell dry-run server:

```powershell
$env:SANDBOX_DRY_RUN="true"; npm run dev
```

## Windows + WSL2 Real Gondolin Run

Dry-run mode works on Windows directly. Real Gondolin VM execution should be run inside WSL2 Ubuntu.

1. Install Node.js 24+ in WSL2.
2. Install QEMU:

```bash
sudo apt update
sudo apt install qemu-system-arm nodejs npm
```

3. From the project directory mounted in WSL2:

```bash
npm install
SANDBOX_DRY_RUN=false npm run demo
```

If your WSL2 kernel or hardware does not expose acceleration, Gondolin may still run more slowly or fail at VM startup. Keep `SANDBOX_DRY_RUN=true` for CI and local policy tests.

## Network Policy

Profiles:

```text
none      -> []
npm       -> registry.npmjs.org
python    -> pypi.org, files.pythonhosted.org
github    -> github.com, api.github.com, raw.githubusercontent.com
web-basic -> example.com
custom    -> request allowedHosts
```

The adapter passes the resolved allowlist to `createHttpHooks` when the installed Gondolin SDK exposes it.

## Troubleshooting

- Node version too old: install Node.js 24+.
- QEMU missing: install the WSL2 Ubuntu QEMU package.
- `/dev/kvm` missing: use dry-run mode or enable virtualization support.
- `EPERM: operation not permitted, symlink ... .cache\gondolin`: Windows denied Gondolin image-cache symlink creation. Run real Gondolin from WSL2 Ubuntu as described above, or use `SANDBOX_DRY_RUN=true` for Windows-local UI and lifecycle testing.
- Gondolin cannot start in this environment: use `SANDBOX_DRY_RUN=true`; tests and demo still exercise policy, validation, logging, and lifecycle.
- npm registry blocked by policy: create the session with `networkProfile: "npm"`.
- secrets unavailable: make sure the target host is allowlisted for that secret.
