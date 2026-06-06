/**
 * Embedding model backed by OCI Generative AI (text-embedding-3-large).
 * Falls back to a deterministic FNV-1a stub when OCI is not configured
 * or for offline tests.
 *
 * OCI endpoint: POST /openai/v1/embeddings
 *   { model, input, dimensions, encoding_format }
 * Response: { data: [{ embedding: number[] }] }
 *
 * Uses 384-dim output to match existing sqlite-vec schema (vec0 FLOAT[384]).
 */

import { getLlmProvider, type LlmProvider } from "../oci/LlmProvider.js";
import { createHash } from "node:crypto";

const DIM = 384;
const MAX_BATCH = 96;
const CACHE_MAX = 10_000;

const cache = new Map<string, Float32Array>();

function cacheKey(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

function stubEmbed(text: string): Float32Array {
  const vec = new Float32Array(DIM);
  const tokens = text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
  for (const token of tokens) {
    let hash = 2166136261;
    for (let i = 0; i < token.length; i++) {
      hash = Math.imul(hash ^ token.charCodeAt(i), 16777619) >>> 0;
    }
    for (let d = 0; d < DIM; d++) {
      const seed = (hash + d * 2654435761) >>> 0;
      vec[d] += ((seed / 4294967296) * 2 - 1) / Math.max(1, tokens.length);
    }
  }
  let norm = 0;
  for (let d = 0; d < DIM; d++) norm += vec[d] * vec[d];
  norm = Math.sqrt(norm) || 1;
  for (let d = 0; d < DIM; d++) vec[d] /= norm;
  return vec;
}

let provider: LlmProvider | null = null;
function getProvider(): LlmProvider {
  if (!provider) provider = getLlmProvider();
  return provider;
}

/** Synchronous embed — uses cache, otherwise returns stub. Async fill via warmCache. */
export function embed(text: string): Float32Array {
  const key = cacheKey(text);
  const cached = cache.get(key);
  if (cached) return cached;
  if (!text.trim()) return new Float32Array(DIM);
  const stub = stubEmbed(text);
  cache.set(key, stub);
  if (cache.size > CACHE_MAX) {
    const first = cache.keys().next().value;
    if (first !== undefined) cache.delete(first);
  }
  return stub;
}

/** Async embed — calls OCI when available, caches, falls back to stub. */
export async function embedAsync(text: string, dimensions = DIM): Promise<Float32Array> {
  const key = cacheKey(text);
  const cached = cache.get(key);
  if (cached) return cached;
  if (!text.trim()) return new Float32Array(DIM);
  const p = getProvider();
  if (p.isAvailable()) {
    try {
      const [vec] = await p.generateEmbeddings([text], dimensions);
      if (vec && vec.length === dimensions) {
        cache.set(key, vec);
        if (cache.size > CACHE_MAX) {
          const first = cache.keys().next().value;
          if (first !== undefined) cache.delete(first);
        }
        return vec;
      }
    } catch { /* fall through to stub */ }
  }
  const stub = stubEmbed(text);
  cache.set(key, stub);
  return stub;
}

/** Batch async embed — OCI supports up to 96 inputs per request. */
export async function embedBatch(texts: string[], dimensions = DIM): Promise<Float32Array[]> {
  const out: Array<Float32Array | null> = new Array(texts.length).fill(null);
  const toFetch: Array<{ index: number; text: string }> = [];

  for (let i = 0; i < texts.length; i++) {
    const t = texts[i];
    if (!t || !t.trim()) {
      out[i] = new Float32Array(DIM);
      continue;
    }
    const cached = cache.get(cacheKey(t));
    if (cached) { out[i] = cached; continue; }
    toFetch.push({ index: i, text: t });
  }

  const p = getProvider();
  if (toFetch.length > 0 && p.isAvailable()) {
    try {
      for (let off = 0; off < toFetch.length; off += MAX_BATCH) {
        const chunk = toFetch.slice(off, off + MAX_BATCH);
        const chunkTexts = chunk.map((c) => c.text);
        const vectors = await p.generateEmbeddings(chunkTexts, dimensions);
        for (let j = 0; j < chunk.length; j++) {
          const v = vectors[j];
          if (v) {
            cache.set(cacheKey(chunk[j].text), v);
            out[chunk[j].index] = v;
          }
        }
      }
    } catch { /* fall through to stub */ }
  }

  for (let i = 0; i < texts.length; i++) {
    if (!out[i]) {
      const stub = stubEmbed(texts[i]);
      cache.set(cacheKey(texts[i]), stub);
      out[i] = stub;
    }
  }
  return out as Float32Array[];
}

/** Invalidate the in-memory cache (used by tests). */
export function clearCache(): void {
  cache.clear();
}

export function vecToBuffer(vec: Float32Array): Buffer {
  return Buffer.from(vec.buffer);
}

export function bufferToVec(buf: Buffer): Float32Array {
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}
