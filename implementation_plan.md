# Implementation Plan

Fix receiver-side remote file-request search and approval-binding so exact filename requests ("Send me Job Offer-Associate Consultant.pdf file") reliably find the file via filename-first search, 0-candidate cases show refinement/manual-bind UI instead of misleading pending approval with null boundFilePath, only create transferable approval when a real file is bound, send status updates back to sender, and complete the end-to-end transfer with SHA-256 verification.

The current flow in RemoteTaskDispatcher.dispatch / handleMessageSend extracts noisy text, uses QueryRewriter (which removes some stop words but not all request verbs and does not extract exactFilename), runs HybridRetrievalPipeline (FTS5 on diluted query, vec fallback to FNV stub, RRF with weak filenameScore, no exact filename priority or extension filter from request), creates approval with top=candidates[0] (null when 0), leading to ApprovalTransferOrchestrator skipping on !boundFilePath and PersonalAgentProtocol.createApproval allowing null bounds. This matches the screenshots (file request received, searching, 0 candidates, pending approval with no file, no transfer). Local agent works because it uses full intent pipeline; remote does not. The fix adds FileRequestParser to extract cleanQuery/exactFilename/extensions, FileRequestSearch with exact-filename priority then FTS/vec fallback (returning reason per candidate), updates dispatcher to use parser+search and avoid transferable approval on 0 candidates (instead show refinement card with "Search Again / Choose File / Reject"), adds manual rebind endpoint usage in UI, disables approve until bound, sends relay status updates, and adds E2E test. This fits existing retrieval/intent/protocol/runtime without new deps, respects sandbox/audit boundaries, uses Zod for parser output, and follows AGENTS.md (focused tests, Conventional Commits).

[Types]
Extend RewrittenQuery and RetrievalMatch with filename-specific fields; add FileRequestParseResult and update ApprovalRecord/DeliveryStatus with validation rules.

type FileRequestParseResult = {
  originalText: string;
  cleanQuery: string; // stop words removed, normalized
  exactFilename: string | null; // "Job Offer-Associate Consultant.pdf"
  extensions: string[]; // [".pdf"]
  requestWordsRemoved: string[];
  confidence: number; // 0-1
};

interface RetrievalMatch {
  id: number;
  filePath: string;
  displayPath: string;
  fileName: string;
  extension: string;
  sizeBytes: number;
  modifiedAt: string;
  score: number;
  reason: "exact-filename" | "normalized-filename" | "filename-token-match" | "lexical" | "semantic" | "recency";
}

type ApprovalRecord = { // extended from PersonalAgentProtocol.ts
  ...existing fields,
  boundFilePath: string | null; // required for transferable
  selectedFileId: string | null;
  status: "pending" | "approved" | "rejected" | "feedback_received" | "expired" | "search_refinement";
};

Use Zod schemas (z.object with .refine for confidence > 0.7 and exactFilename matching extension pattern) at parser and API boundaries.

[Files]
Create 2 new files, modify 8 existing files; no deletions or moves; update tests and docs.

New files:
- src/intent/FileRequestParser.ts (parses noisy requests into cleanQuery/exactFilename/extensions per PHASE 1 rules, with Zod validation)
- src/retrieval/FileRequestSearch.ts (filename-first search with exact/case-insensitive/token/FTS/vec fallback per PHASE 2, returns matches with reason)

Existing files modified:
- src/runtime/RemoteTaskDispatcher.ts (replace extractRequestText + rewrite + hybridSearch with parseFileRequest + searchFileRequest; if candidates.length === 0 create refinement card/task state SEARCH_NEEDS_REFINEMENT instead of transferable approval; update handleMessageSend to use peer routing if needed and send status receipt)
- src/retrieval/HybridRetrievalPipeline.ts (expose or extend search to accept FileRequestParseResult for filename priority boost before RRF)
- src/protocol/PersonalAgentProtocol.ts (update createApproval to reject null boundFilePath for "file.transfer.offer" type, add createRefinementApproval for 0-candidate case)
- src/runtime/ApprovalTransferOrchestrator.ts (add check for boundFilePath before scheduling, improve error for null bound)
- src/server.ts (add /files/search/debug endpoint per PHASE 8, update approval routes for rebind-file and status updates, integrate new parser/search in chat relay handler)
- src/intent/IntentExtractor.ts (extend to detect file_request intent and pass to parser)
- ui/src/components/stream-like/ApprovalCard.tsx or equivalent UI file (disable approve if !boundFilePath, show "No candidate files found. Search again / Choose file / Reject", use human names not agent IDs, add manual file picker calling rebind)
- tests/FileSearch.test.ts and tests/ChatPersistence.test.ts (add tests for parser, FileRequestSearch with exact filename, 0-candidate flow, E2E relay-file-search)
- docs/retrieval-algorithms.md and README.md (document new filename-first path and 0-candidate handling)

Configuration updates: none (reuses existing Zod/LLM provider).

[Functions]
Add 4 new functions, modify 7 existing ones.

New functions:
- parseFileRequest(text: string): FileRequestParseResult in src/intent/FileRequestParser.ts (signature: (text: string) => FileRequestParseResult; purpose: extract exactFilename, cleanQuery, extensions from noisy requests like "Send me Job Offer-Associate Consultant.pdf file" using regex for extensions, stop word removal, confidence scoring)
- searchFileRequest(parsed: FileRequestParseResult, options?: SearchOptions): RetrievalMatch[] in src/retrieval/FileRequestSearch.ts (signature: (parsed: FileRequestParseResult, options?: SearchOptions) => RetrievalMatch[]; purpose: exact filename match first, then normalized/token/FTS/vec fallback with reason, limit 10)
- createRefinementCard(taskId: string, parsed: FileRequestParseResult, indexedCount: number): void in src/runtime/RemoteTaskDispatcher.ts (purpose: append "No candidate files found" message with refinement actions for 0-candidate case)
- getSearchDebug(query: string): {parsed: FileRequestParseResult, candidatesByReason: Record<string, RetrievalMatch[]>, indexedRoots: number} in src/server.ts (purpose: diagnostics endpoint per PHASE 8)

Modified functions:
- dispatch(message: RelayInboxMessage) in src/runtime/RemoteTaskDispatcher.ts (exact name, current file src/runtime/RemoteTaskDispatcher.ts; required changes: for "message.send" or file request, use parseFileRequest + searchFileRequest instead of rewrite+hybridSearch; if 0 candidates create refinement instead of approval with null bound; appendMessage with refinement payload; ack only after success)
- rewrite(query: string): RewrittenQuery in src/intent/QueryRewriter.ts (exact name, current file src/intent/QueryRewriter.ts; required changes: improve STOP_WORDS and FILE_EXT_PATTERN to better extract exactFilename, add exactFilename to return type)
- search(query: string, options: SearchOptions) in src/retrieval/HybridRetrievalPipeline.ts (exact name, current file src/retrieval/HybridRetrievalPipeline.ts; required changes: if options.exactFilename, add exact filename query before FTS/RRF with higher weight)
- createApproval(...) in src/protocol/PersonalAgentProtocol.ts (exact name, current file src/protocol/PersonalAgentProtocol.ts; required changes: throw or set status "search_refinement" if !selectedFileId && approvalType === "file.transfer.offer"; add support for refinement type)
- scheduleForApproval(approval: ApprovalRecord) in src/runtime/ApprovalTransferOrchestrator.ts (exact name, current file src/runtime/ApprovalTransferOrchestrator.ts; required changes: improve skipped reason for null bound, add logging for 0-candidate cases)
- applyApprovalDecision(...) in src/protocol/PersonalAgentProtocol.ts (exact name, current file src/protocol/PersonalAgentProtocol.ts; required changes: on feedback, trigger new search with refined query and create new approval instead of terminal state)
- renderApprovalCard or equivalent in UI approval component (exact name if identifiable, current file ui/src/components/...ApprovalCard.tsx; required changes: disable approve if !boundFilePath, show human names, add "Choose file" button calling rebind, refinement UI)

Removed functions: none (deprecated direct hybridSearch on noisy text is replaced by parse+searchFileRequest; migration: update calls in dispatcher).

[Classes]
Add 2 new classes.

New classes:
- FileRequestParser (file path src/intent/FileRequestParser.ts, key methods: parse, extractExactFilename using regex for common extensions, removeRequestVerbs; no inheritance, uses Zod for output validation)
- FileRequestSearch (file path src/retrieval/FileRequestSearch.ts, key methods: exactMatch, tokenMatch, fallbackToHybrid; extends or uses HybridRetrievalPipeline, returns matches with reason)

Modified classes:
- RemoteTaskDispatcher (exact name, file path src/runtime/RemoteTaskDispatcher.ts; specific modifications: inject/use FileRequestParser and FileRequestSearch in dispatch/handleMessageSend, conditional approval creation only on candidates.length > 0, add refinement card for 0 candidates, send status receipt to sender via RelayClient)
- PersonalAgentProtocol (exact name, file path src/protocol/PersonalAgentProtocol.ts; specific modifications: update createApproval to enforce boundFilePath for transferable type, add createRefinementTask method, improve feedback to create new approval)
- RuleBasedQueryRewriter (exact name, file path src/intent/QueryRewriter.ts; specific modifications: enhance STOP_WORDS and add exactFilename extraction to RewrittenQuery)

No removed classes.

[Dependencies]
No new packages or version changes (reuses existing zod, node:fs, retrieval pipeline, LLM provider). Add PeerRoutingService import if routing is extended for file requests (from previous plan). Integration requirement: register new parser in createQueryRewriter or IntentExtractor.

[Testing]
Add 4 new focused test files (tests/FileRequestParser.test.ts, tests/FileRequestSearch.test.ts, tests/RemoteFileRequest.test.ts, update tests/FileSearch.test.ts and tests/ChatPersistence.test.ts); modify existing E2E for relay-file-search to prove exact filename, 0-candidate refinement, manual bind, end-to-end transfer with SHA verification. Validation: run npm test, npm run test:e2e:relay-file-search, verify with curl /files/search/debug and admin audit; ensure no transferable approval on 0 candidates, UI disables approve, sender receives status updates. Name tests FeatureName.test.ts per AGENTS.md; use mocked embeddings and indexed fixtures.

[Implementation Order]
Implement in the exact PHASE order from the diagnosis to first add parser (foundational for clean input), then search, then dispatcher integration, approval safety, UI, status updates, tests, and diagnostics to minimize conflicts and ensure incremental verification.

1. Create src/intent/FileRequestParser.ts with parseFileRequest and Zod schema (PHASE 1).
2. Create src/retrieval/FileRequestSearch.ts with exact-filename priority search (PHASE 2).
3. Update src/runtime/RemoteTaskDispatcher.ts to use parser + searchFileRequest and handle 0-candidate refinement instead of null-bound approval (PHASE 3).
4. Update src/protocol/PersonalAgentProtocol.ts and ApprovalTransferOrchestrator.ts for boundFilePath enforcement and feedback creating new approval (PHASE 4,6).
5. Add manual rebind support and UI changes in server.ts approval routes and UI approval card (PHASE 5,10).
6. Add sender status updates via relay receipts (PHASE 7).
7. Add /files/search/debug endpoint and diagnostics (PHASE 8).
8. Add all new tests and update E2E for full flow (PHASE 9).
9. Run full test suite, verify with curls on both agents, update docs/README.
10. Commit with Conventional Commits (e.g. feat(retrieval): filename-first search for remote file requests).