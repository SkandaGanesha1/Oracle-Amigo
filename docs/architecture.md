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

## Remote Relay File Requests

Remote `file.request` relay items are resolved through the shared `FileRequestCandidateResolver` before an approval is created. The resolver uses `FileRequestParser` to extract exact filenames, clean request words, extensions, and query keywords. It then ranks candidates in this order:

1. Exact/case-insensitive/normalized filename matches in `file_index`
2. Filename token matches from `FileRequestSearch`
3. Hybrid FTS5/sqlite-vec retrieval through `HybridRetrievalPipeline.search()`
4. Live `FileSearchService.search()` over configured safe roots when the index is empty or stale

Transfer approvals require a bound file path, SHA-256, and size on the receiver only. Unbound requests become `file.search.refinement`, can be retried with `/approvals/:id/feedback`, or can be manually bound with `/approvals/:id/rebind-file`. Public API responses use safe display names, hashes, sizes, and generated identifiers; raw local file paths are kept server-side.

The requester receives progress as `file.request.status` relay messages: delivered, searching receiver files, no candidate/refinement needed, waiting for approval, transfer starting, and file received/hash verified.

## Loopback-Peer Mode

- Two agent instances on ports 3399 and 3400
- Each has separate SQLite database and storage folder
- ANP handshake establishes peer session between them
- A2A task messages flow between agents via HTTP
- Same code paths as future remote mode
