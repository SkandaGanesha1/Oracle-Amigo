/**
 * ANP trust-level calculation.
 *
 * A peer's trust level is derived from a small set of orthogonal signals:
 *   - DID method (did:key = self-signed, did:wba = bootstrap-verified)
 *   - Whether the DID has been seen before (first contact vs repeat)
 *   - Whether the peer resolved successfully via the DID resolver
 *   - Optional user-pinned overrides (e.g. "this DID is in my contacts")
 *   - The network locality (loopback / private IP / public)
 *
 * Outputs are one of `local`, `loopback`, `verified`, or `untrusted`.
 */

export type TrustLevel = "local" | "loopback" | "verified" | "untrusted";

export type TrustInputs = {
  /** DID of the peer being evaluated */
  did: string | null;
  /** Resolution result from the DID resolver; null if it failed */
  resolution: { method: "key" | "wba"; controller?: string } | null;
  /** Whether the peer address (host:port) is loopback */
  isLoopback: boolean;
  /** Whether the peer has been seen before in the local database */
  hasPriorSession: boolean;
  /** Optional user-pinned trust override (e.g. trusted contact) */
  pinnedLevel?: TrustLevel;
};

const LOOPBACK_PRIORITY: TrustLevel[] = ["local", "loopback", "verified", "untrusted"];

export function calculateTrustLevel(inputs: TrustInputs): TrustLevel {
  if (inputs.pinnedLevel) return inputs.pinnedLevel;
  if (inputs.isLoopback) return "loopback";

  if (!inputs.did || !inputs.resolution) return "untrusted";

  if (inputs.resolution.method === "wba" && inputs.hasPriorSession) {
    return "verified";
  }

  if (inputs.resolution.method === "key" && inputs.hasPriorSession) {
    return "verified";
  }

  return "untrusted";
}

export function isTrustAtLeast(level: TrustLevel, minimum: TrustLevel): boolean {
  return LOOPBACK_PRIORITY.indexOf(level) <= LOOPBACK_PRIORITY.indexOf(minimum);
}

/** Heuristic loopback detection (IPv4 loopback + `localhost`). */
export function isLoopbackAddress(host: string): boolean {
  if (!host) return false;
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "127.0.0.1" || host === "::1" || host === "[::1]") return true;
  // 127.0.0.0/8
  if (/^127\.\d+\.\d+\.\d+$/.test(host)) return true;
  return false;
}
