import type { A2Av1AgentCard, A2Av1Interface } from "../../../../src/protocol/a2a-v1/types.js";
import { cardFingerprint, signCardWithRs256 } from "../../../../src/protocol/a2a-v1/AgentCardV1.js";

export interface CloudAgentCardOptions {
  publicBaseUrl: string;
  agentInstanceId: string;
  signingKey?: { privateKeyPem: string; kid: string };
}

const LOCAL_URL_RE = /\b(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?/i;
const WINDOWS_PATH_RE = /[A-Za-z]:[\\/][^\s"'<>]+/;
const FILE_URL_RE = /file:\/\/\//i;

export function relayInboxUrl(publicBaseUrl: string): string {
  return `${trimTrailingSlash(publicBaseUrl)}/v1/relay/a2a/inbox`;
}

export function agentCardUrl(publicBaseUrl: string, agentInstanceId: string): string {
  return relayAgentBaseUrl(publicBaseUrl, agentInstanceId);
}

export function relayAgentBaseUrl(publicBaseUrl: string, agentInstanceId: string): string {
  return `${trimTrailingSlash(publicBaseUrl)}/v1/relay/a2a/${encodeURIComponent(agentInstanceId)}`;
}

export function toCloudAgentCard(
  storedCard: Record<string, unknown>,
  opts: CloudAgentCardOptions
): A2Av1AgentCard {
  const publicBaseUrl = trimTrailingSlash(opts.publicBaseUrl);
  const agentBaseUrl = relayAgentBaseUrl(publicBaseUrl, opts.agentInstanceId);
  const unsigned = stripSignatures(sanitizePublicValue(storedCard, publicBaseUrl)) as Partial<A2Av1AgentCard>;
  const card: Omit<A2Av1AgentCard, "signatures"> = {
    protocolVersion: unsigned.protocolVersion ?? "1.0",
    name: typeof unsigned.name === "string" ? unsigned.name : "Oracle Amigo Agent",
    description: typeof unsigned.description === "string" ? unsigned.description : undefined,
    url: agentBaseUrl,
    preferredTransport: unsigned.preferredTransport ?? "HTTP+JSON",
    supportedInterfaces: cloudInterfaces(unsigned.supportedInterfaces, agentBaseUrl),
    iconUrl: typeof unsigned.iconUrl === "string" ? unsigned.iconUrl : undefined,
    provider: unsigned.provider,
    version: typeof unsigned.version === "string" ? unsigned.version : "0.1.0",
    documentationUrl: typeof unsigned.documentationUrl === "string" ? unsigned.documentationUrl : undefined,
    capabilities: unsigned.capabilities ?? {},
    securitySchemes: unsigned.securitySchemes,
    securityRequirements: unsigned.securityRequirements,
    defaultInputModes: Array.isArray(unsigned.defaultInputModes) ? unsigned.defaultInputModes : ["text/plain", "application/json"],
    defaultOutputModes: Array.isArray(unsigned.defaultOutputModes) ? unsigned.defaultOutputModes : ["text/plain", "application/json"],
    skills: Array.isArray(unsigned.skills) ? unsigned.skills : [],
    tenant: typeof unsigned.tenant === "string" ? unsigned.tenant : undefined
  };
  const cleaned = removeUndefined(card) as Omit<A2Av1AgentCard, "signatures">;
  if (opts.signingKey) {
    return signCardWithRs256(cleaned, opts.signingKey.privateKeyPem, opts.signingKey.kid);
  }
  return cleaned as A2Av1AgentCard;
}

export function cloudAgentCardHash(card: A2Av1AgentCard): string {
  return cardFingerprint(card);
}

function cloudInterfaces(value: unknown, agentBaseUrl: string): A2Av1Interface[] {
  const source = Array.isArray(value) ? value : [];
  const out = source
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => {
      const binding = typeof item.protocolBinding === "string" ? item.protocolBinding : "HTTP+JSON";
      const protocolVersion = item.protocolVersion === "1.0" ? item.protocolVersion : "1.0";
      const next: A2Av1Interface = {
        url: binding === "HTTP+JSON" ? `${agentBaseUrl}/v1` : safeUrl(item.url, agentBaseUrl),
        protocolBinding: binding as A2Av1Interface["protocolBinding"],
        protocolVersion,
        tenant: typeof item.tenant === "string" ? item.tenant : undefined,
        extensions: Array.isArray(item.extensions) ? item.extensions.filter((e): e is string => typeof e === "string") : []
      };
      return removeUndefined(next) as A2Av1Interface;
    });
  if (!out.some((item) => item.protocolBinding === "HTTP+JSON")) {
    out.unshift({
      url: `${agentBaseUrl}/v1`,
      protocolBinding: "HTTP+JSON",
      protocolVersion: "1.0",
      extensions: []
    });
  }
  return out;
}

function sanitizePublicValue(value: unknown, publicBaseUrl: string): unknown {
  if (typeof value === "string") return sanitizeString(value, publicBaseUrl);
  if (Array.isArray(value)) return value.map((item) => sanitizePublicValue(item, publicBaseUrl));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = sanitizePublicValue(item, publicBaseUrl);
    }
    return out;
  }
  return value;
}

function sanitizeString(value: string, publicBaseUrl: string): string {
  if (LOCAL_URL_RE.test(value)) return value.replace(/https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?/gi, publicBaseUrl);
  if (FILE_URL_RE.test(value) || WINDOWS_PATH_RE.test(value)) return "[redacted-local]";
  return value;
}

function safeUrl(value: unknown, publicBaseUrl: string): string {
  return typeof value === "string" && !LOCAL_URL_RE.test(value) && !FILE_URL_RE.test(value)
    ? value
    : publicBaseUrl;
}

function stripSignatures(value: unknown): Record<string, unknown> {
  const obj = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const { signatures: _signatures, ...unsigned } = obj;
  return unsigned;
}

function removeUndefined(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(removeUndefined);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (typeof item !== "undefined") out[key] = removeUndefined(item);
    }
    return out;
  }
  return value;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}
