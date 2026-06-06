import type { SourceHello, DestinationHello } from "./AnpProtocol.js";

export const ANP_META_PROTOCOL_VERSION = "1.0";

export const ANP_CAPABILITY_IDS = {
  ENCRYPTED_MESSAGE: "encryptedMessage",
  SIGNED_MESSAGE: "signedMessage",
  PUBSUB_MESSAGE: "pubsubMessage",
  HUMAN_AUTHORIZATION: "humanAuthorization",
  CROSS_PLATFORM_AUTH: "crossPlatformHttpAuth",
  PAYMENT_REQUEST: "paymentRequest",
  PAYMENT_SETTLEMENT: "paymentSettlement",
  FILE_TRANSFER: "fileTransfer",
  AGENT_DESCRIPTION_ADP: "agentDescriptionProtocol",
  AGENT_DISCOVERY: "agentDiscoveryProtocol",
  NATURAL_LANGUAGE: "naturalLanguageProtocol",
  VERIFICATION: "verificationProtocol",
} as const;

export type AnpCapability = (typeof ANP_CAPABILITY_IDS)[keyof typeof ANP_CAPABILITY_IDS];

export const ANP_APPLICATION_PROTOCOLS = {
  DIDCOMM_V2: "didcomm/v2",
  WAKU: "waku/v1",
  NOISE: "noise/xx",
  TLS_13: "tls/1.3",
  AP2_PAYMENT: "ap2/payment/v1",
  E2E_FILE_TRANSFER: "anp/file-transfer/v1",
  ADP_DESCRIPTION: "anp/adp/v1",
  ANP_DISCOVERY: "anp/discovery/v1",
  WNS_HANDLE: "anp/wns/v1",
} as const;

export type AnpApplicationProtocol =
  (typeof ANP_APPLICATION_PROTOCOLS)[keyof typeof ANP_APPLICATION_PROTOCOLS];

export const REQUIRED_CAPABILITIES: AnpCapability[] = [
  ANP_CAPABILITY_IDS.ENCRYPTED_MESSAGE,
  ANP_CAPABILITY_IDS.SIGNED_MESSAGE,
];

export const OPTIONAL_CAPABILITIES: AnpCapability[] = [
  ANP_CAPABILITY_IDS.PUBSUB_MESSAGE,
  ANP_CAPABILITY_IDS.HUMAN_AUTHORIZATION,
  ANP_CAPABILITY_IDS.CROSS_PLATFORM_AUTH,
  ANP_CAPABILITY_IDS.PAYMENT_REQUEST,
  ANP_CAPABILITY_IDS.PAYMENT_SETTLEMENT,
  ANP_CAPABILITY_IDS.FILE_TRANSFER,
  ANP_CAPABILITY_IDS.AGENT_DESCRIPTION_ADP,
  ANP_CAPABILITY_IDS.AGENT_DISCOVERY,
  ANP_CAPABILITY_IDS.NATURAL_LANGUAGE,
  ANP_CAPABILITY_IDS.VERIFICATION,
];

export const DEFAULT_PROTOCOL_FOR_CAPABILITY: Record<AnpCapability, AnpApplicationProtocol | null> = {
  [ANP_CAPABILITY_IDS.ENCRYPTED_MESSAGE]: ANP_APPLICATION_PROTOCOLS.DIDCOMM_V2,
  [ANP_CAPABILITY_IDS.SIGNED_MESSAGE]: ANP_APPLICATION_PROTOCOLS.DIDCOMM_V2,
  [ANP_CAPABILITY_IDS.PUBSUB_MESSAGE]: ANP_APPLICATION_PROTOCOLS.WAKU,
  [ANP_CAPABILITY_IDS.HUMAN_AUTHORIZATION]: null,
  [ANP_CAPABILITY_IDS.CROSS_PLATFORM_AUTH]: ANP_APPLICATION_PROTOCOLS.TLS_13,
  [ANP_CAPABILITY_IDS.PAYMENT_REQUEST]: ANP_APPLICATION_PROTOCOLS.AP2_PAYMENT,
  [ANP_CAPABILITY_IDS.PAYMENT_SETTLEMENT]: ANP_APPLICATION_PROTOCOLS.AP2_PAYMENT,
  [ANP_CAPABILITY_IDS.FILE_TRANSFER]: ANP_APPLICATION_PROTOCOLS.E2E_FILE_TRANSFER,
  [ANP_CAPABILITY_IDS.AGENT_DESCRIPTION_ADP]: ANP_APPLICATION_PROTOCOLS.ADP_DESCRIPTION,
  [ANP_CAPABILITY_IDS.AGENT_DISCOVERY]: ANP_APPLICATION_PROTOCOLS.ANP_DISCOVERY,
  [ANP_CAPABILITY_IDS.NATURAL_LANGUAGE]: ANP_APPLICATION_PROTOCOLS.DIDCOMM_V2,
  [ANP_CAPABILITY_IDS.VERIFICATION]: ANP_APPLICATION_PROTOCOLS.DIDCOMM_V2,
};

export interface CapabilitySet {
  capabilities: AnpCapability[];
  protocols: AnpApplicationProtocol[];
  requiredOnly?: boolean;
}

export const DEFAULT_CAPABILITY_SET: CapabilitySet = {
  capabilities: [...REQUIRED_CAPABILITIES, ...OPTIONAL_CAPABILITIES],
  protocols: Object.values(ANP_APPLICATION_PROTOCOLS),
};

export const MINIMAL_CAPABILITY_SET: CapabilitySet = {
  capabilities: [...REQUIRED_CAPABILITIES],
  protocols: [ANP_APPLICATION_PROTOCOLS.DIDCOMM_V2, ANP_APPLICATION_PROTOCOLS.TLS_13],
};

export interface NegotiationResult {
  ok: boolean;
  sharedCapabilities: AnpCapability[];
  sharedProtocols: AnpApplicationProtocol[];
  selectedProtocol?: AnpApplicationProtocol;
  rejectedCapabilities: AnpCapability[];
  rejectedProtocols: AnpApplicationProtocol[];
  reason?: string;
}

export function negotiateMetaProtocol(
  sourceHello: SourceHello,
  destinationHello: DestinationHello,
): NegotiationResult {
  if (sourceHello.metaProtocol.version !== ANP_META_PROTOCOL_VERSION) {
    return {
      ok: false,
      sharedCapabilities: [],
      sharedProtocols: [],
      rejectedCapabilities: sourceHello.metaProtocol.supportedCapabilities.filter(isCapabilityNegotiable),
      rejectedProtocols: (sourceHello.metaProtocol.candidateProtocols ?? []).filter(isProtocolSupported),
      reason: `Unsupported meta-protocol version: ${sourceHello.metaProtocol.version}`,
    };
  }
  if (destinationHello.metaProtocol.version !== ANP_META_PROTOCOL_VERSION) {
    return {
      ok: false,
      sharedCapabilities: [],
      sharedProtocols: [],
      rejectedCapabilities: sourceHello.metaProtocol.supportedCapabilities.filter(isCapabilityNegotiable),
      rejectedProtocols: (sourceHello.metaProtocol.candidateProtocols ?? []).filter(isProtocolSupported),
      reason: `Destination meta-protocol version: ${destinationHello.metaProtocol.version}`,
    };
  }
  const sourceCaps = new Set<string>(sourceHello.metaProtocol.supportedCapabilities);
  const destCaps = new Set<string>(destinationHello.metaProtocol.supportedCapabilities);
  const sharedCapabilities: AnpCapability[] = [];
  const rejectedCapabilities: AnpCapability[] = [];
  for (const cap of sourceCaps) {
    if (isCapabilityNegotiable(cap) && destCaps.has(cap)) {
      sharedCapabilities.push(cap);
    } else if (isCapabilityNegotiable(cap)) {
      rejectedCapabilities.push(cap);
    }
  }
  for (const required of REQUIRED_CAPABILITIES) {
    if (!sharedCapabilities.includes(required)) {
      return {
        ok: false,
        sharedCapabilities,
        sharedProtocols: [],
        rejectedCapabilities,
        rejectedProtocols: (sourceHello.metaProtocol.candidateProtocols ?? []).filter(isProtocolSupported),
        reason: `Required capability not supported by destination: ${required}`,
      };
    }
  }
  const sourceProtocols = new Set<string>(sourceHello.metaProtocol.candidateProtocols ?? []);
  const sharedProtocols: AnpApplicationProtocol[] = [];
  const rejectedProtocols: AnpApplicationProtocol[] = [];
  for (const proto of sourceProtocols) {
    if (isProtocolSupported(proto) && proto === destinationHello.metaProtocol.selectedProtocol) {
      sharedProtocols.push(proto);
    } else if (isProtocolSupported(proto)) {
      rejectedProtocols.push(proto);
    }
  }
  const selectedProtocol = destinationHello.metaProtocol.selectedProtocol as
    | AnpApplicationProtocol
    | undefined;
  return {
    ok: true,
    sharedCapabilities,
    sharedProtocols,
    selectedProtocol,
    rejectedCapabilities,
    rejectedProtocols,
  };
}

export function isCapabilityNegotiable(capability: string): capability is AnpCapability {
  return (Object.values(ANP_CAPABILITY_IDS) as string[]).includes(capability);
}

export function isProtocolSupported(protocol: string): protocol is AnpApplicationProtocol {
  return (Object.values(ANP_APPLICATION_PROTOCOLS) as string[]).includes(protocol);
}
