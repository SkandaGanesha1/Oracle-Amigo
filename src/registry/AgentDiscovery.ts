import { createHash } from "node:crypto";
import type { AgentCard } from "../protocol/a2a/types.js";
import { getAgent, upsertAgent, touchLastSeen } from "./AgentRegistry.js";

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_USER_AGENT = "Oracle-Amigo/0.2.0 (agent-registry)";

export interface FetchAgentCardInput {
  url: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export async function fetchAgentCard(input: FetchAgentCardInput): Promise<{ card: AgentCard; cardHash: string }> {
  const f = input.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const res = await f(input.url, {
      headers: { "user-agent": DEFAULT_USER_AGENT, accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Agent card fetch failed: HTTP ${res.status}`);
    const card = await res.json() as AgentCard;
    const cardHash = hashCard(card);
    return { card, cardHash };
  } finally {
    clearTimeout(timeout);
  }
}

export function hashCard(card: AgentCard): string {
  return createHash("sha256").update(canonicalize(card)).digest("hex");
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const parts = keys.map((k) => `${JSON.stringify(k)}:${canonicalize((value as Record<string, unknown>)[k])}`);
  return `{${parts.join(",")}}`;
}

export interface DiscoverAndRegisterInput {
  url: string;
  did?: string;
  trustLevel?: "local" | "loopback" | "trusted" | "discovered" | "blocked";
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export async function discoverAndRegister(input: DiscoverAndRegisterInput): Promise<{ did: string; card: AgentCard; cardHash: string }> {
  const { card, cardHash } = await fetchAgentCard({ url: input.url, fetchImpl: input.fetchImpl, timeoutMs: input.timeoutMs });
  const did = input.did ?? (card as { id?: string }).id ?? input.url;
  const anpEndpoint = extractAnpEndpoint(card);
  const supportedProtocols = extractProtocols(card);
  const skills = card.skills?.map((s) => s.id) ?? [];
  upsertAgent({
    did,
    name: card.name ?? did,
    description: card.description ?? "",
    agentCardUrl: input.url,
    anpEndpoint,
    supportedProtocols,
    skills,
    trustLevel: input.trustLevel ?? "discovered",
    lastCardHash: cardHash,
  });
  return { did, card, cardHash };
}

function extractAnpEndpoint(card: AgentCard & { anpEndpoint?: string }): string {
  if ((card as { anpEndpoint?: string }).anpEndpoint) return (card as { anpEndpoint: string }).anpEndpoint;
  if (Array.isArray(card.additionalInterfaces)) {
    const anp = card.additionalInterfaces.find((i) => i.transport === "ANP" || /anp|message/i.test(i.url));
    if (anp) return anp.url;
  }
  return "";
}

function extractProtocols(card: AgentCard): string[] {
  const out: string[] = [];
  if (Array.isArray(card.additionalInterfaces)) {
    for (const i of card.additionalInterfaces) {
      out.push(i.transport);
    }
  }
  if (card.preferredTransport) out.push(card.preferredTransport);
  if (card.protocolVersion) out.push("A2A/" + card.protocolVersion);
  return out;
}

export function refreshAgent(did: string, fetchImpl?: typeof fetch): Promise<{ card: AgentCard; cardHash: string } | null> {
  const record = getAgent(did);
  if (!record) return Promise.resolve(null);
  if (!record.agentCardUrl) return Promise.resolve(null);
  return fetchAgentCard({ url: record.agentCardUrl, fetchImpl })
    .then(({ card, cardHash }) => {
      touchLastSeen(did);
      upsertAgent({ did, name: card.name ?? did, description: card.description ?? "", lastCardHash: cardHash });
      return { card, cardHash };
    })
    .catch(() => null);
}
