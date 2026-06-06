export type TaskState =
  | "submitted"
  | "working"
  | "input-required"
  | "completed"
  | "rejected"
  | "failed"
  | "canceled"
  | "auth-required"
  | "unknown";

export type Role = "user" | "agent";

export type FileMimeType = string;

export interface FileBase {
  name?: string;
  mimeType?: FileMimeType;
}

export interface FileWithBytes extends FileBase {
  bytes: string;
  uri?: never;
}

export interface FileWithUri extends FileBase {
  uri: string;
  bytes?: never;
}

export type FileContent = FileWithBytes | FileWithUri;

export interface PartBase {
  metadata?: Record<string, unknown>;
}

export interface TextPart extends PartBase {
  readonly kind: "text";
  text: string;
}

export interface FilePart extends PartBase {
  readonly kind: "file";
  file: FileContent;
}

export interface DataPart extends PartBase {
  readonly kind: "data";
  data: Record<string, unknown>;
}

export type Part = TextPart | FilePart | DataPart;

export interface Message {
  readonly kind: "message";
  readonly role: Role;
  parts: Part[];
  messageId: string;
  taskId?: string;
  contextId?: string;
  referenceTaskIds?: string[];
  extensions?: string[];
  metadata?: Record<string, unknown>;
}

export interface Artifact {
  artifactId: string;
  name?: string;
  description?: string;
  parts: Part[];
  metadata?: Record<string, unknown>;
  extensions?: string[];
}

export interface TaskStatus {
  state: TaskState;
  message?: Message;
  timestamp?: string;
}

export interface Task {
  readonly kind: "task";
  id: string;
  contextId: string;
  status: TaskStatus;
  history?: Message[];
  artifacts?: Artifact[];
  metadata?: Record<string, unknown>;
}

export interface TaskStatusUpdateEvent {
  taskId: string;
  contextId: string;
  readonly kind: "status-update";
  status: TaskStatus;
  final: boolean;
  metadata?: Record<string, unknown>;
}

export interface TaskArtifactUpdateEvent {
  taskId: string;
  contextId: string;
  readonly kind: "artifact-update";
  artifact: Artifact;
  append?: boolean;
  lastChunk?: boolean;
  metadata?: Record<string, unknown>;
}

export type SendStreamingMessageResult =
  | Message
  | Task
  | TaskStatusUpdateEvent
  | TaskArtifactUpdateEvent;

export interface AgentInterface {
  url: string;
  transport: "JSONRPC" | "GRPC" | "HTTP+JSON" | string;
}

export interface AgentProvider {
  organization: string;
  url: string;
}

export interface AgentExtension {
  uri: string;
  description?: string;
  required?: boolean;
  params?: Record<string, unknown>;
}

export interface AgentCapabilities {
  streaming?: boolean;
  pushNotifications?: boolean;
  stateTransitionHistory?: boolean;
  extensions?: AgentExtension[];
}

export interface AgentSkill {
  id: string;
  name: string;
  description: string;
  tags: string[];
  examples?: string[];
  inputModes?: string[];
  outputModes?: string[];
  security?: Array<Record<string, string[]>>;
}

export interface APIKeySecurityScheme {
  type: "apiKey";
  in: "header" | "query" | "cookie";
  name: string;
  description?: string;
}

export interface HTTPAuthSecurityScheme {
  type: "http";
  scheme: string;
  bearerFormat?: string;
  description?: string;
}

export interface OAuthFlow {
  authorizationUrl?: string;
  tokenUrl?: string;
  refreshUrl?: string;
  scopes: Record<string, string>;
}

export interface OAuthFlows {
  implicit?: OAuthFlow;
  password?: OAuthFlow;
  clientCredentials?: OAuthFlow;
  authorizationCode?: OAuthFlow;
}

export interface OAuth2SecurityScheme {
  type: "oauth2";
  flows: OAuthFlows;
  description?: string;
}

export interface OpenIdConnectSecurityScheme {
  type: "openIdConnect";
  openIdConnectUrl: string;
  description?: string;
}

export interface MutualTLSSecurityScheme {
  type: "mutualTLS";
  description?: string;
}

export type SecurityScheme =
  | APIKeySecurityScheme
  | HTTPAuthSecurityScheme
  | OAuth2SecurityScheme
  | OpenIdConnectSecurityScheme
  | MutualTLSSecurityScheme;

export interface AgentCardSignature {
  protected: string;
  signature: string;
  header?: Record<string, unknown>;
}

export interface AgentCard {
  protocolVersion: string;
  name: string;
  description: string;
  url: string;
  preferredTransport: "JSONRPC" | "GRPC" | "HTTP+JSON" | string;
  additionalInterfaces?: AgentInterface[];
  provider?: AgentProvider;
  version: string;
  documentationUrl?: string;
  capabilities: AgentCapabilities;
  defaultInputModes: string[];
  defaultOutputModes: string[];
  skills: AgentSkill[];
  signatures?: AgentCardSignature[];
  securitySchemes?: Record<string, SecurityScheme>;
  security?: Array<Record<string, string[]>>;
  iconUrl?: string;
  supportsAuthenticatedExtendedCard?: boolean;
}

export type JSONRPCVersion = "2.0";

export interface JSONRPCRequest<P = unknown> {
  jsonrpc: JSONRPCVersion;
  id: string | number | null;
  method: string;
  params?: P;
}

export interface JSONRPCSuccess<R = unknown> {
  jsonrpc: JSONRPCVersion;
  id: string | number | null;
  result: R;
}

export interface JSONRPCError {
  jsonrpc: JSONRPCVersion;
  id: string | number | null;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export type JSONRPCResponse<R = unknown> = JSONRPCSuccess<R> | JSONRPCError;

export const JSONRPC_ERROR_CODES = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  TASK_NOT_FOUND: -32001,
  TASK_NOT_CANCELABLE: -32002,
  PUSH_NOTIFICATION_NOT_SUPPORTED: -32003,
  UNSUPPORTED_OPERATION: -32004,
  CONTENT_TYPE_NOT_SUPPORTED: -32005,
  INVALID_AGENT_RESPONSE: -32006,
  AUTHENTICATED_EXTENDED_CARD_NOT_CONFIGURED: -32007,
} as const;

export interface MessageSendConfiguration {
  acceptedOutputModes?: string[];
  historyLength?: number;
  pushNotificationConfig?: PushNotificationConfig;
  blocking?: boolean;
}

export interface MessageSendParams {
  message: Message;
  configuration?: MessageSendConfiguration;
  metadata?: Record<string, unknown>;
}

export interface TaskIdParams {
  id: string;
  metadata?: Record<string, unknown>;
}

export interface TaskQueryParams extends TaskIdParams {
  historyLength?: number;
}

export interface ListTaskQueryParams {
  contextId?: string;
  status?: TaskState;
  pageSize?: number;
  pageToken?: string;
  historyLength?: number;
}

export interface PushNotificationAuthenticationInfo {
  schemes: string[];
  credentials?: string;
}

export interface PushNotificationConfig {
  id?: string;
  url: string;
  token?: string;
  authentication?: PushNotificationAuthenticationInfo;
}

export interface TaskPushNotificationConfig {
  taskId: string;
  pushNotificationConfig: PushNotificationConfig;
}

export interface GetTaskPushNotificationConfigParams extends TaskIdParams {
  pushNotificationConfigId?: string;
}

export interface ListTaskPushNotificationConfigParams extends TaskIdParams {}

export interface DeleteTaskPushNotificationConfigParams extends TaskIdParams {
  pushNotificationConfigId: string;
}

export interface TaskListResult {
  tasks: Task[];
  nextPageToken?: string;
  totalSize?: number;
}

export type AgentCardGetResult = AgentCard;

export const A2A_PROTOCOL_VERSION = "0.3.0";
