---
id: file-search
name: File Search
description: Hybrid FTS5 + vector retrieval over indexed local files. Returns ranked candidates with snippets and PDF preview URLs.
version: 0.1.0
tags: [file-search, retrieval, local-files, hybrid]
examples: ["find the API design PDF", "search quarterly report xlsx", "look up meeting notes from last week"]
inputModes: [text/plain]
outputModes: [application/json, text/plain]
---

# File Search

Performs a hybrid search across all configured file roots using:

1. SQLite FTS5 over filenames and extracted text content
2. sqlite-vec vector search over file embeddings (384-dim)
3. Lexical + semantic score fusion with snippet extraction

## Inputs

A natural language query (e.g. "API design doc from March").

## Outputs

- `candidates`: ranked list of `{path, score, snippet, previewUrl?}`
- `rootsSearched`: list of roots queried
- `elapsedMs`: total search time
