import type { LocalIdentity } from "../DeviceIdentity.js";
import type { AgentCard } from "../../protocol/a2a/types.js";
import {
  ANP_CAPABILITY_IDS,
  ANP_APPLICATION_PROTOCOLS,
  type AnpCapability,
  type AnpApplicationProtocol,
} from "./AnpMetaProtocol.js";

export const ADP_CONTEXT_IRIS = {
  ADP: "https://agent-network-protocol.com/adp/v1",
  SECURITY: "https://w3id.org/security/v1",
  DID: "https://www.w3.org/ns/did/v1",
  SCHEMA_ORG: "https://schema.org/",
  WNS: "https://agent-network-protocol.com/wns/v1",
} as const;

export interface AdpInterface {
  type: "AnpInterface";
  protocol: AnpApplicationProtocol | string;
  url: string;
  capabilities: AnpCapability[];
  authentication?: Array<{
    type: "HttpSignature" | "OAuth2" | "ApiKey" | "MutualTLS";
    description?: string;
  }>;
}

export interface AdpOrganization {
  type: "Organization";
  name: string;
  url?: string;
  logo?: string;
}

export interface AdpSkill {
  type: "AnpSkill";
  id: string;
  name: string;
  description: string;
  tags: string[];
  examples?: string[];
  inputContentTypes: string[];
  outputContentTypes: string[];
}

export interface AdpAgentDescription {
  "@context": string | string[];
  "@type": "AnpAgentDescription";
  id: string;
  type: "AnpAgentDescription";
  name: string;
  description: string;
  url: string;
  version: string;
  provider: AdpOrganization;
  documentation?: string;
  capabilities: AnpCapability[];
  interfaces: AdpInterface[];
  skills: AdpSkill[];
  humanAuthorizationRequired: boolean;
  trustLevel: "self-attested" | "verified" | "authoritative";
  updatedAt: string;
  expiresAt?: string;
  proof?: {
    type: "DataIntegrityProof";
    cryptosuite: "eddsa-jcs-2022";
    verificationMethod: string;
    created: string;
    proofPurpose: "assertionMethod";
    proofValue: string;
  };
}

export interface BuildAdpInput {
  identity: LocalIdentity;
  agentCard: AgentCard;
  organization: { name: string; url?: string };
  capabilities: AnpCapability[];
  baseUrl: string;
  anpEndpointUrl: string;
  humanAuthorizationRequired: boolean;
  trustLevel?: "self-attested" | "verified" | "authoritative";
  expiresAt?: string;
}

export function buildAdpAgentDescription(input: BuildAdpInput): AdpAgentDescription {
  const capabilities = new Set<AnpCapability>(input.capabilities);
  capabilities.add(ANP_CAPABILITY_IDS.AGENT_DESCRIPTION_ADP);
  capabilities.add(ANP_CAPABILITY_IDS.SIGNED_MESSAGE);
  capabilities.add(ANP_CAPABILITY_IDS.ENCRYPTED_MESSAGE);

  const interfaces: AdpInterface[] = [];

  interfaces.push({
    type: "AnpInterface",
    protocol: ANP_APPLICATION_PROTOCOLS.DIDCOMM_V2,
    url: input.anpEndpointUrl,
    capabilities: [
      ANP_CAPABILITY_IDS.ENCRYPTED_MESSAGE,
      ANP_CAPABILITY_IDS.SIGNED_MESSAGE,
    ],
    authentication: [{ type: "HttpSignature", description: "DID:WBA signature" }],
  });

  if (capabilities.has(ANP_CAPABILITY_IDS.FILE_TRANSFER)) {
    interfaces.push({
      type: "AnpInterface",
      protocol: ANP_APPLICATION_PROTOCOLS.E2E_FILE_TRANSFER,
      url: `${input.baseUrl}/anp/file-transfer`,
      capabilities: [ANP_CAPABILITY_IDS.FILE_TRANSFER],
      authentication: [{ type: "HttpSignature" }],
    });
  }

  if (capabilities.has(ANP_CAPABILITY_IDS.PAYMENT_REQUEST)) {
    interfaces.push({
      type: "AnpInterface",
      protocol: ANP_APPLICATION_PROTOCOLS.AP2_PAYMENT,
      url: `${input.baseUrl}/anp/payment`,
      capabilities: [
        ANP_CAPABILITY_IDS.PAYMENT_REQUEST,
        ANP_CAPABILITY_IDS.PAYMENT_SETTLEMENT,
      ],
      authentication: [{ type: "OAuth2" }, { type: "HttpSignature" }],
    });
  }

  const skills: AdpSkill[] = input.agentCard.skills.map((s) => ({
    type: "AnpSkill",
    id: s.id,
    name: s.name,
    description: s.description,
    tags: s.tags,
    examples: s.examples,
    inputContentTypes: s.inputModes ?? input.agentCard.defaultInputModes,
    outputContentTypes: s.outputModes ?? input.agentCard.defaultOutputModes,
  }));

  const description: AdpAgentDescription = {
    "@context": [
      ADP_CONTEXT_IRIS.ADP,
      ADP_CONTEXT_IRIS.SECURITY,
      ADP_CONTEXT_IRIS.SCHEMA_ORG,
    ],
    "@type": "AnpAgentDescription",
    id: input.identity.did,
    type: "AnpAgentDescription",
    name: input.agentCard.name,
    description: input.agentCard.description,
    url: input.agentCard.url,
    version: input.agentCard.version,
    provider: {
      type: "Organization",
      name: input.organization.name,
      ...(input.organization.url ? { url: input.organization.url } : {}),
    },
    documentation: input.agentCard.documentationUrl,
    capabilities: Array.from(capabilities),
    interfaces,
    skills,
    humanAuthorizationRequired: input.humanAuthorizationRequired,
    trustLevel: input.trustLevel ?? "self-attested",
    updatedAt: new Date().toISOString(),
    expiresAt: input.expiresAt,
  };

  return description;
}

export function buildAdpMinimal(agentDid: string, name: string, description: string): AdpAgentDescription {
  return {
    "@context": [ADP_CONTEXT_IRIS.ADP],
    "@type": "AnpAgentDescription",
    id: agentDid,
    type: "AnpAgentDescription",
    name,
    description,
    url: "",
    version: "1.0.0",
    provider: { type: "Organization", name: "Unknown" },
    capabilities: [],
    interfaces: [],
    skills: [],
    humanAuthorizationRequired: false,
    trustLevel: "self-attested",
    updatedAt: new Date().toISOString(),
  };
}

export function getAdpEndpointFor(
  description: AdpAgentDescription,
  protocol: AnpApplicationProtocol,
): string | null {
  for (const iface of description.interfaces) {
    if (iface.protocol === protocol) return iface.url;
  }
  return null;
}
