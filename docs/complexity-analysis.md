# Complexity Analysis

## File Indexing

**Full index**: O(F × extraction_cost + F × embedding_cost)
- F = number of files
- extraction_cost = O(1) for metadata, O(content_size) for text extraction
- embedding_cost = O(tokens × D) for stub embedding (FNV-1a)

**Incremental index**: O(C × extraction_cost + C × embedding_cost)
- C = changed files only (detected by mtime/size comparison)

## Lexical Retrieval (FTS5)

SQLite FTS5: O(log N) per query term using inverted index
- N = number of indexed documents
- Practical: sub-millisecond for typical document collections

## Vector Retrieval (sqlite-vec)

**Exact KNN**: O(N × d)
- N = vector count, d = embedding dimension (384)
- Current implementation: exhaustive scan (sqlite-vec loads all vectors into memory for distance computation)

**With ANN (future)**: O(log N × d) with supported index if available in sqlite-vec

## RRF Fusion

O(R) where R = union of retrieved candidates from FTS5 (50) + vec (50)
- Map-based scoring: O(R) insert/lookup
- Sorting: O(R log R)

## MMR Diversity

O(k² × d) for top-k reranking
- k = output limit (typically 10-20)
- d = embedding dimension (384)
- Each of k selections compares against k-1 already selected
- With k=20, this is ~400 cosine similarity computations

## SHA-256 File Hashing

**Time**: O(file_size) — streamed in chunks
**Memory**: O(chunk_size) — default 64KB, not full file load

## Task State Transitions

**Validation**: O(1) — Set.has() lookup in valid transition table
**Write**: O(1) — single INSERT into workflow_events + audit_events

## Audit Hash Chain

**Append**: O(1) + SHA-256 hash over serialized event (~1KB)
**Verification**: O(E) where E = total events — recomputes each hash sequentially
