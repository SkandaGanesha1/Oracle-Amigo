/**
 * ANP replay protection.
 *
 * Maintains a bounded LRU of seen nonces (keyed by `peer + offerId + nonce`) to detect
 * replayed handshakes. Entries expire after `ttlSeconds` (default 24h) and are
 * pruned lazily on every insert.
 *
 * The store is in-memory; in a multi-process deployment swap this with a shared
 * store (Redis or SQLite). The interface is the same.
 */
export type AnpReplayEntry = {
  key: string;
  peer: string;
  offerId: string;
  nonce: string;
  seenAt: number; // epoch ms
};

export type AnpReplayStoreOptions = {
  ttlSeconds?: number;
  maxEntries?: number;
};

export class AnpReplayStore {
  private readonly entries = new Map<string, AnpReplayEntry>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;

  constructor(options: AnpReplayStoreOptions = {}) {
    this.ttlMs = (options.ttlSeconds ?? 24 * 60 * 60) * 1000;
    this.maxEntries = options.maxEntries ?? 50_000;
  }

  /** Check-and-record: returns `true` if this is a NEW nonce, `false` if replayed. */
  checkAndRecord(peer: string, offerId: string, nonce: string, now: number = Date.now()): boolean {
    this.prune(now);
    const key = makeKey(peer, offerId, nonce);
    if (this.entries.has(key)) return false;
    this.entries.set(key, { key, peer, offerId, nonce, seenAt: now });
    if (this.entries.size > this.maxEntries) {
      // Drop oldest by seenAt
      const oldest = [...this.entries.values()].sort((a, b) => a.seenAt - b.seenAt)[0];
      if (oldest) this.entries.delete(oldest.key);
    }
    return true;
  }

  has(peer: string, offerId: string, nonce: string): boolean {
    return this.entries.has(makeKey(peer, offerId, nonce));
  }

  size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }

  private prune(now: number): void {
    const cutoff = now - this.ttlMs;
    for (const [key, entry] of this.entries) {
      if (entry.seenAt < cutoff) this.entries.delete(key);
    }
  }
}

function makeKey(peer: string, offerId: string, nonce: string): string {
  return `${peer}|${offerId}|${nonce}`;
}
