# Demo Guide

## Prerequisites

- Node.js ≥24
- npm
- .NET 8 SDK (optional, for Windows notification bridge)
- Windows 10/11 with App SDK (optional, for notifications)

## Single-Device Demo

```bash
# 1. Start the agent server
npm run dev:agent

# 2. In another terminal, start the UI
npm run dev:ui

# 3. Open browser at http://127.0.0.1:5173

# 4. Click "Agent Chat" tab

# 5. Type: "find API design PDF"

# 6. See ranked candidate files in the approval card

# 7. Click "Select & Approve" to approve a file

# 8. Verify file appears in "Files" panel

# Or run automated demo:
npm run demo:single-device
```

## Loopback Two-Agent Demo

```bash
# Runs two agents on ports 3399 and 3400 with separate profiles
npm run demo:loopback-two-agents
```

## Test Suite

```bash
# Run all unit tests
npm test

# Run loopback integration test
npm run test:e2e

# Run tests with UI
npx vitest --ui
```

## Notification Bridge (Windows)

```bash
# Start the notification bridge (requires .NET 8 SDK)
npm run dev:notification-bridge
```

## Acceptance Checklist

- [ ] App runs locally on Windows
- [ ] Local profile and agent identity initialized
- [ ] Agent Card endpoint returns valid card
- [ ] A2A task endpoints working
- [ ] ANP identity and handshake objects created
- [ ] Files indexed into SQLite + sqlite-vec
- [ ] File request via chat → ranked candidates
- [ ] Approval card shown in UI
- [ ] Approve from UI → file stored in Agentic Storage
- [ ] Reject from UI works
- [ ] Feedback refines search
- [ ] SHA-256 verified file storage
- [ ] Transfer receipt created
- [ ] Audit events written and chain validates
- [ ] Tests pass
- [ ] Loopback two-agent mode works
- [ ] No hardcoded users, paths, or IDs
