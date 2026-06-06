import {
  type AgentCard,
  type AgentInterface,
  type AgentSkill,
  type AgentCapabilities,
  A2A_PROTOCOL_VERSION,
} from "./types.js";

export interface BuildAgentCardInput {
  name: string;
  description: string;
  version: string;
  baseUrl: string;
  organization: string;
  organizationUrl?: string;
  skills: AgentSkill[];
  capabilities?: Partial<AgentCapabilities>;
  defaultInputModes?: string[];
  defaultOutputModes?: string[];
  documentationUrl?: string;
  iconUrl?: string;
  supportsAuthenticatedExtendedCard?: boolean;
}

export function buildAgentCard(input: BuildAgentCardInput): AgentCard {
  const jsonrpcInterface: AgentInterface = {
    url: `${input.baseUrl}/a2a/jsonrpc`,
    transport: "JSONRPC",
  };

  const sseInterface: AgentInterface = {
    url: `${input.baseUrl}/a2a/stream`,
    transport: "JSONRPC",
  };

  const additionalInterfaces: AgentInterface[] = [sseInterface];

  const capabilities: AgentCapabilities = {
    streaming: true,
    pushNotifications: true,
    stateTransitionHistory: true,
    extensions: [],
    ...input.capabilities,
  };

  const provider: AgentCard["provider"] = input.organizationUrl
    ? { organization: input.organization, url: input.organizationUrl }
    : { organization: input.organization, url: input.baseUrl };

  return {
    protocolVersion: A2A_PROTOCOL_VERSION,
    name: input.name,
    description: input.description,
    url: jsonrpcInterface.url,
    preferredTransport: "JSONRPC",
    additionalInterfaces,
    provider,
    version: input.version,
    documentationUrl: input.documentationUrl,
    capabilities,
    defaultInputModes: input.defaultInputModes ?? ["text/plain"],
    defaultOutputModes: input.defaultOutputModes ?? ["application/json", "text/plain"],
    skills: input.skills,
    iconUrl: input.iconUrl,
    supportsAuthenticatedExtendedCard:
      input.supportsAuthenticatedExtendedCard ?? false,
  };
}

export const ORACLE_AMIGO_SKILLS: AgentSkill[] = [
  {
    id: "file.request.search",
    name: "Search local files",
    description:
      "Search indexed local files by name, content, and metadata using hybrid FTS5 + vector retrieval.",
    tags: ["file-search", "retrieval", "local-files"],
    examples: ["find the API design PDF", "search for quarterly report xlsx"],
    inputModes: ["text/plain"],
    outputModes: ["application/json", "text/plain"],
  },
  {
    id: "file.transfer.offer",
    name: "Transfer files",
    description:
      "Offer approved files for transfer to peer agents via A2A task lifecycle.",
    tags: ["file-transfer", "approval"],
    examples: ["offer API_Design_Final.pdf to peer-agent"],
    inputModes: ["text/plain"],
    outputModes: ["application/json"],
  },
  {
    id: "file.transfer.receive",
    name: "Receive files",
    description:
      "Receive and store files from peer agents into Agentic App Storage with SHA-256 verification.",
    tags: ["file-transfer", "storage"],
    examples: ["accept incoming file from peer-agent"],
    inputModes: ["application/json"],
    outputModes: ["application/json"],
  },
  {
    id: "human.approval.request",
    name: "Human approval",
    description:
      "Request human approval before file transfer via UI card or Windows notification.",
    tags: ["approval", "human-in-the-loop"],
    examples: ["approve candidate file", "reject with feedback"],
    inputModes: ["text/plain"],
    outputModes: ["application/json"],
  },
  {
    id: "agent.skills.discover",
    name: "Discover agent skills",
    description:
      "Discover and activate skills published at /.well-known/agent-skills/ on peer agents.",
    tags: ["skills", "discovery"],
    examples: ["list available skills", "activate file-search skill"],
    inputModes: ["text/plain"],
    outputModes: ["application/json"],
  },
  {
    id: "agent.anp.handshake",
    name: "ANP handshake",
    description:
      "Perform ANP DID:WBA handshake with ECDHE key exchange for encrypted peer-to-peer communication.",
    tags: ["anp", "did:wba", "handshake", "ecdhe"],
    examples: ["establish encrypted channel with peer"],
    inputModes: ["application/json"],
    outputModes: ["application/json"],
  },
];
