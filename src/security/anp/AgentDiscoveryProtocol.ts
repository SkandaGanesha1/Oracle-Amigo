import { createHash } from "node:crypto";
import type { AdpAgentDescription } from "./AgentDescriptionProtocol.js";
import { ANP_APPLICATION_PROTOCOLS, type AnpApplicationProtocol } from "./AnpMetaProtocol.js";

export interface DiscoveryRequest {
  capabilities?: string[];
  protocols?: string[];
  trustLevel?: Array<"self-attested" | "verified" | "authoritative">;
  maxResults?: number;
}

export interface DiscoveredAgent {
  did: string;
  name: string;
  description: string;
  capabilities: string[];
  protocols: string[];
  adpUrl: string;
  trustLevel: string;
  score: number;
  discoveredAt: string;
}

export interface DiscoveryResult {
  query: DiscoveryRequest;
  total: number;
  results: DiscoveredAgent[];
  nextPageToken?: string;
}

export function scoreAgent(
  adp: AdpAgentDescription,
  query: DiscoveryRequest,
): { score: number; matched: string[] } {
  let score = 0;
  const matched: string[] = [];
  if (query.capabilities && query.capabilities.length > 0) {
    for (const cap of query.capabilities) {
      if (adp.capabilities.includes(cap as never)) {
        score += 10;
        matched.push(cap);
      }
    }
  } else {
    score += 1;
  }
  if (query.protocols && query.protocols.length > 0) {
    for (const proto of query.protocols) {
      if (adp.interfaces.some((i) => i.protocol === proto)) {
        score += 5;
      }
    }
  }
  if (query.trustLevel && query.trustLevel.length > 0) {
    if (query.trustLevel.includes(adp.trustLevel)) score += 3;
  } else {
    score += 1;
  }
  if (adp.humanAuthorizationRequired) score += 1;
  return { score, matched };
}

export function buildDiscoveryResult(
  descriptions: AdpAgentDescription[],
  query: DiscoveryRequest,
): DiscoveryResult {
  const scored = descriptions
    .map((adp) => {
      const { score, matched } = scoreAgent(adp, query);
      return {
        did: adp.id,
        name: adp.name,
        description: adp.description,
        capabilities: adp.capabilities,
        protocols: adp.interfaces.map((i) => i.protocol),
        adpUrl: adp.interfaces[0]?.url ?? "",
        trustLevel: adp.trustLevel,
        score,
        discoveredAt: new Date().toISOString(),
        _matched: matched,
      };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);

  const maxResults = query.maxResults ?? 50;
  const page = scored.slice(0, maxResults);
  return {
    query,
    total: scored.length,
    results: page.map(({ _matched, ...rest }) => rest),
    nextPageToken:
      scored.length > maxResults
        ? createHash("sha256").update(String(maxResults)).digest("hex").slice(0, 16)
        : undefined,
  };
}

export interface WnsHandle {
  handle: string;
  did: string;
  publicKeyHex: string;
  registeredAt: string;
  expiresAt?: string;
  signature: string;
}

export interface ResolveWnsHandleInput {
  handle: string;
  registryDid: string;
  registryPubKeyHex: string;
}

const WNS_HANDLE_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;

export function isValidWnsHandle(handle: string): boolean {
  return WNS_HANDLE_PATTERN.test(handle);
}

export function wnsHandleToDid(handle: string, domain: string): string {
  if (!isValidWnsHandle(handle)) {
    throw new Error(`Invalid WNS handle: ${handle}`);
  }
  const normalized = handle.toLowerCase();
  return `did:wns:${domain}:${normalized}`;
}

export function buildWnsHandleRecord(input: {
  handle: string;
  did: string;
  publicKeyHex: string;
  ttlSeconds?: number;
  signature: string;
}): WnsHandle {
  if (!isValidWnsHandle(input.handle)) {
    throw new Error(`Invalid WNS handle: ${input.handle}`);
  }
  return {
    handle: input.handle.toLowerCase(),
    did: input.did,
    publicKeyHex: input.publicKeyHex,
    registeredAt: new Date().toISOString(),
    expiresAt: input.ttlSeconds
      ? new Date(Date.now() + input.ttlSeconds * 1000).toISOString()
      : undefined,
    signature: input.signature,
  };
}

export const SUPPORTED_DISCOVERY_PROTOCOLS: AnpApplicationProtocol[] = [
  ANP_APPLICATION_PROTOCOLS.ANP_DISCOVERY,
  ANP_APPLICATION_PROTOCOLS.ADP_DESCRIPTION,
];
