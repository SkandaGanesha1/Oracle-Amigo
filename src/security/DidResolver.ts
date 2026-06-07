/**
 * DID resolution for ANP.
 *
 * Supports:
 *   - `did:key:z...` — self-resolving Ed25519 public keys (multibase base58btc).
 *   - `did:wba:host:port:ed25519:<fingerprint>` — well-known bootstrap agent
 *     addresses that resolve to the agent's published public key via HTTPS
 *     `GET /.well-known/did.json` on the host:port.
 *
 * Unknown DID methods return `null` and the caller should treat the peer as
 * untrusted.
 */
import { createHash, createPublicKey, X509Certificate } from "node:crypto";
import { request as httpsRequest, RequestOptions } from "node:https";
import { request as httpRequest, RequestOptions as HttpRequestOptions } from "node:http";

export type DidResolution = {
  did: string;
  /** hex-encoded Ed25519 public key (32 bytes) */
  publicKeyHex: string;
  /** DID method (key, wba) */
  method: "key" | "wba";
  /** Optional human-readable controller hint (e.g. "agent.local" for did:wba) */
  controller?: string;
  /** When the resolution was performed (epoch ms) */
  resolvedAt: number;
  /** TTL in seconds before the caller should re-resolve */
  ttlSeconds: number;
};

const DEFAULT_TTL_SECONDS = 3600;

export type ResolverOptions = {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

/**
 * Resolve a DID to its public key. Pure (no I/O) for `did:key`; uses the supplied
 * `fetchImpl` (or global `fetch`) for `did:wba`.
 */
export async function resolveDid(did: string, options: ResolverOptions = {}): Promise<DidResolution | null> {
  if (!did || typeof did !== "string") return null;
  const method = didMethod(did);
  if (method === "key") return resolveDidKey(did);
  if (method === "wba") return resolveDidWba(did, options);
  return null;
}

function didMethod(did: string): "key" | "wba" | "unknown" {
  if (did.startsWith("did:key:")) return "key";
  if (did.startsWith("did:wba:")) return "wba";
  return "unknown";
}

function resolveDidKey(did: string): DidResolution | null {
  // did:key:z<multibase base58btc> where the multibase prefix 'z' means base58btc
  // and the multicodec prefix 0xed01 means Ed25519.
  const value = did.slice("did:key:".length);
  if (!value.startsWith("z")) return null;
  const decoded = base58btcDecode(value.slice(1));
  if (!decoded) return null;
  // multicodec 0xed (Ed25519 public key) → drop the leading 2 bytes.
  if (decoded.length < 2) return null;
  if (decoded[0] !== 0xed || decoded[1] !== 0x01) return null;
  const rawKey = decoded.subarray(2);
  if (rawKey.length !== 32) return null;
  return {
    did,
    publicKeyHex: rawKey.toString("hex"),
    method: "key",
    resolvedAt: Date.now(),
    ttlSeconds: DEFAULT_TTL_SECONDS,
  };
}

async function resolveDidWba(did: string, options: ResolverOptions): Promise<DidResolution | null> {
  // did:wba:host:port:ed25519:<fingerprint> OR did:wba:host:ed25519:<fingerprint>
  const parts = did.split(":");
  // ["did", "wba", host, port?, "ed25519", fingerprint]
  if (parts.length < 5 || parts[2].length === 0) return null;
  const host = parts[2];
  const port = parts.length === 6 ? Number(parts[3]) : undefined;
  if (port !== undefined && (Number.isNaN(port) || port <= 0 || port > 65535)) return null;
  const fingerprint = parts[parts.length - 1];
  const url = port
    ? `https://${host}:${port}/.well-known/did.json`
    : `https://${host}/.well-known/did.json`;

  const fetchImpl = options.fetchImpl ?? (globalThis as { fetch?: typeof fetch }).fetch;
  if (!fetchImpl) return null;

  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), options.timeoutMs ?? 5_000);
    const res = await fetchImpl(url, { signal: ac.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const body = (await res.json()) as { did?: string; publicKey?: string; publicKeyPem?: string };
    if (body.did !== did) return null;
    if (body.publicKey) {
      // hex
      const rawKey = Buffer.from(body.publicKey, "hex");
      if (rawKey.length !== 32) return null;
      return {
        did,
        publicKeyHex: body.publicKey,
        method: "wba",
        controller: host,
        resolvedAt: Date.now(),
        ttlSeconds: DEFAULT_TTL_SECONDS,
      };
    }
    if (body.publicKeyPem) {
      const pubKey = createPublicKey(body.publicKeyPem);
      const rawKey = pubKey.export({ format: "der", type: "spki" });
      // Strip the 12-byte SPKI header for Ed25519
      const spkiPrefix = Buffer.from("302a300506032b6570032100", "hex");
      if (rawKey.length !== spkiPrefix.length + 32) return null;
      if (!rawKey.subarray(0, spkiPrefix.length).equals(spkiPrefix)) return null;
      return {
        did,
        publicKeyHex: rawKey.subarray(spkiPrefix.length).toString("hex"),
        method: "wba",
        controller: host,
        resolvedAt: Date.now(),
        ttlSeconds: DEFAULT_TTL_SECONDS,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/** Minimal Base58BTC decoder (Bitcoin alphabet). Returns Buffer or null. */
function base58btcDecode(input: string): Buffer | null {
  const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  if (input.length === 0) return Buffer.alloc(0);
  const bytes: number[] = [0];
  for (const ch of input) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) return null;
    let carry = idx;
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  // Count leading '1's
  let leadingZeros = 0;
  for (const ch of input) {
    if (ch === "1") leadingZeros++;
    else break;
  }
  const result = Buffer.from([...new Array(leadingZeros).fill(0), ...bytes.reverse()]);
  return result;
}

/** Cache wrapper to avoid re-resolving the same DID on every handshake. */
export class DidCache {
  private readonly cache = new Map<string, { value: DidResolution; expiresAt: number }>();

  async resolve(did: string, options: ResolverOptions = {}): Promise<DidResolution | null> {
    const cached = this.cache.get(did);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    const fresh = await resolveDid(did, options);
    if (fresh) this.cache.set(did, { value: fresh, expiresAt: Date.now() + fresh.ttlSeconds * 1000 });
    return fresh;
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }
}
