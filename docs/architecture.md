# Architecture

## Component Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    UI (React + Vite)                        │
│  ┌──────────┐  ┌────────────┐  ┌──────────┐  ┌──────────┐  │
│  │ Chat     │  │ Approval   │  │ Received │  │ Audit    │  │
│  │ Panel    │  │ Card       │  │ Files    │  │ Timeline │  │
│  └────┬─────┘  └─────┬──────┘  └────┬─────┘  └────┬─────┘  │
│       │               │              │              │        │
└───────┼───────────────┼──────────────┼──────────────┼────────┘
        │               │              │              │
   POST /chat/messages  │              │         GET /audit/events
        │               │              │
┌───────┼───────────────┼──────────────┼──────────────┼────────┐
│       ▼               ▼              ▼              ▼        │
│  ┌──────────────────────────────────────────────────────┐    │
│  │              Local HTTP Server (Fastify)              │   │
│  │              127.0.0.1:3399                           │   │
│  └──────┬───────────────────────────────────┬───────────┘    │
│         │                                   │                │
│  ┌──────▼────────┐              ┌───────────▼──────────┐    │
│  │ PersonalAgent │              │   A2A/ANP Adapters   │    │
│  │   Protocol    │              │                      │    │
│  └──────┬────────┘              └───────────┬──────────┘    │
│         │                                   │                │
│  ┌──────▼───────────────────────────────────▼──────────┐    │
│  │                    SQLite (node:sqlite)               │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────────────┐   │   │
│  │  │  Schema  │  │  FTS5    │  │  vec0 (sqlite-vec)│   │   │
│  │  │ Tables   │  │  Index   │  │  Embeddings       │   │   │
│  │  └──────────┘  └──────────┘  └──────────────────┘   │   │
│  └────────────────────────────────────────────────────┘    │
│                                                             │
│  ┌────────────────────────────────────────────────────┐    │
│  │              Agentic Storage Folder                 │    │
│  │  staging/  approved/  inbox/  sent/  temp/         │    │
│  └────────────────────────────────────────────────────┘    │
│                                                             │
│  ┌────────────────────────────────────────────────────┐    │
│  │         .NET Notification Bridge (optional)         │   │
│  │  localhost:3400 → Windows Toast Notifications      │   │
│  └────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

## Data Flow (Single-Device)

1. User types message in Agent Chat UI
2. `POST /chat/messages` → IntentExtractor classifies
3. If `file_request`: task created in SQLite, state machine transitions
4. `HybridRetrievalPipeline.search()` → FTS5 + vec KNN + RRF + MMR
5. Candidates returned, approval record created
6. UI shows ApprovalCard with ranked candidates
7. User approves → file staged → SHA-256 verified → promoted to Agentic Storage
8. Transfer receipt created, audit event appended to hash chain

## Loopback-Peer Mode

- Two agent instances on ports 3399 and 3400
- Each has separate SQLite database and storage folder
- ANP handshake establishes peer session between them
- A2A task messages flow between agents via HTTP
- Same code paths as future remote mode
