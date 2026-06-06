# Memory Design

## Three Memory Types

### 1. Short-Term Memory

**Purpose**: Current conversation/task working context. Recent messages and file request state.

**Implementation**: `src/memory/ShortTermMemory.ts`
- SQLite `messages` table, scoped by `conversation_id`
- Bounded sliding window with character budget
- `append(conversationId, role, text, json?)` — O(1)
- `getWindow(conversationId, maxChars)` — O(w), w = window size

**Schema**: `messages` table with role, content_text, created_at

### 2. Long-Term Memory

**Purpose**: User preferences, stable facts, repeated file selection patterns.

**Implementation**: `src/memory/LongTermMemory.ts`
- SQLite `memories` table + `memory_embeddings` vec0 table
- `store(namespace, subjectId, text, importance)` — stores fact + embedding
- `retrieve(namespace, queryText, limit)` — KNN over embeddings, ranks by distance × 0.6 + decay_score × 0.4
- Updates `last_accessed_at` on retrieval for decay scoring

**Complexity**:
- Exact vector scan: O(N × d), where N = memory count, d = 384
- Metadata filtering reduces candidate set before ranking

### 3. Episodic Memory

**Purpose**: Past task episodes and approval decisions.

**Implementation**: `src/memory/EpisodicMemory.ts`
- SQLite `episodic_events` table + `episodic_embeddings` vec0 table
- `record(taskId, eventType, summary, payload)` — stores event + embedding
- `retrieveSimilar(query, limit)` — KNN over episodic embeddings
- `getEpisodicBoost(fileId)` — returns 0.05 boost if a prior `FILE_APPROVED` episode exists for the file

**Usage in Retrieval Pipeline**:
- Episodic preference score (weight 0.05) is added to final ranking score
- Previously approved files get a small boost in subsequent searches

### 4. Procedural Memory (Optional)

Policy and workflow rules stored in `config/policies/*.json`.
Deterministic, not LLM-generated.
