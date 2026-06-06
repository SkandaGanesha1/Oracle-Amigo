# Retrieval Algorithms

## Pipeline Overview

1. Intent Classification → 2. Query Normalization → 3. Candidate Generation → 4. Score Fusion → 5. MMR Diversity → 6. Feedback Refinement

## 1. FTS5 Lexical Search

SQLite FTS5 virtual table over `file_name`, `display_path`, `indexed_text`, `extension`.

```sql
SELECT rowid, rank FROM fts_file_index
WHERE fts_file_index MATCH ?
ORDER BY rank LIMIT 50;
```

Returns negative BM25 scores (more negative = better match).

## 2. sqlite-vec Semantic Search

384-dim float vector stored in `file_embeddings` vec0 virtual table.

```sql
SELECT rowid, distance FROM file_embeddings
WHERE embedding MATCH ? AND k = 50;
```

Distance = L2 distance (lower = more similar). Uses deterministic stub embedding
(FNV-1a-based TF-IDF).

## 3. Reciprocal Rank Fusion (RRF)

Combines FTS5 and vec rankings:

```
score(file) = Σ 1/(k + rank_i)
```

Where k = 60 (default). Each retriever contributes equally to the fused score.

## 4. Final Score Formula

```
final_score = 0.40 × norm_vec_score
            + 0.30 × norm_bm25_score
            + 0.15 × filename_match_score
            + 0.10 × recency_score
            + 0.05 × episodic_preference_score
```

Weights are configurable via `RETRIEVAL_WEIGHTS_JSON` env variable.

## 5. Maximal Marginal Relevance (MMR)

```
MMR = λ × relevance(candidate) - (1 - λ) × max_similarity(candidate, selected)
```

Default λ = 0.75. Prevents near-duplicate files from dominating top results.
Cosine similarity over embedding vectors for diversity scoring.

## 6. Feedback Refinement

When user provides feedback:
1. Extract new query terms from feedback text
2. Exclude previously rejected file IDs
3. Adjust extension filters based on feedback intent
4. Re-run search with updated options
5. Store as episodic memory event

## Embedding Model

Current: Deterministic FNV-1a hash-based TF-IDF (384-dim)
Future: @xenova/transformers all-MiniLM-L6-v2 (same interface)
