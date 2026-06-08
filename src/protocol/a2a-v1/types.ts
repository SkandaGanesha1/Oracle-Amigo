// A2A Protocol v1.0.0 — TypeScript type definitions.
// Reference: https://github.com/a2aproject/A2A/blob/v1.0.0/specification/a2a.proto
//
// Spec conformance highlights:
//   - `TaskState` uses SCREAMING_SNAKE_CASE enum constants (TASK_STATE_*)
//   - Members-based polymorphism: NO `kind` discriminator on Message/Task/Artifact
//   - `AgentCard.supportedInterfaces` (v1) replaces v0.3's `additionalInterfaces`
//   - JWS-signed Agent Cards (RFC 7515)
//   - HTTP+JSON preferred binding; JSON-RPC 2.0 optional
//   - Multi-tenancy via `/{tenant}/` URL prefix
//   - ISO 8601 millisecond timestamps
//   - Server-generated task IDs (UUID v4)

export type A2Av1Version = "1.0";

export const A2A_V1_PROTOCOL_VERSION: A2Av1Version = "1.0";
export const A2A_V1_MEDIA_TYPE = "application/a2a+json" as const;
export const A2A_V1_VERSION_HEADER = "A2A-Version" as const;
export const A2A_V1_EXTENSIONS_HEADER = "A2A-Extensions" as const;
export const A2A_V1_AGENT_CARD_PATH = "/.well-known/agent-card.json" as const;

// ===== Task state (SCREAMING_SNAKE_CASE, per proto) =====
export type TaskState =
  | "TASK_STATE_UNSPECIFIED"
  | "TASK_STATE_SUBMITTED"
  | "TASK_STATE_WORKING"
  | "TASK_STATE_INPUT_REQUIRED"
  | "TASK_STATE_COMPLETED"
  | "TASK_STATE_FAILED"
  | "TASK_STATE_REJECTED"
  | "TASK_STATE_CANCELED"
  | "TASK_STATE_AUTH_REQUIRED"
  | "TASK_STATE_UNKNOWN";

// ===== Role (SCREAMING_SNAKE_CASE) =====
export type Role = "ROLE_USER" | "ROLE_AGENT";

// ===== Common A2A error codes (carried forward from v0.3 to v1) =====
export const A2A_ERROR_CODES = {
  TASK_NOT_FOUND: -32001,
  TASK_NOT_CANCELABLE: -32002,
  PUSH_NOTIFICATION_NOT_SUPPORTED: -32003,
  UNSUPPORTED_OPERATION: -32004,
  CONTENT_TYPE_NOT_SUPPORTED: -32005,
  INVALID_AGENT_RESPONSE: -32006,
  AUTHENTICATED_EXTENDED_CARD_NOT_CONFIGURED: -32007
} as const;

export type A2AErrorCode = (typeof A2A_ERROR_CODES)[keyof typeof A2A_ERROR_CODES] | number;

export interface A2AError {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  code?: A2AErrorCode;
  data?: unknown;
}

// ===== Agent Interface (v1) =====
export type A2Av1ProtocolBinding = "HTTP+JSON" | "JSON-RPC 2.0" | "GRPC" | "WEBSOCKET";

export interface A2Av1Interface {
  url: string;
  protocolBinding: A2Av1ProtocolBinding;
  protocolVersion: A2Av1Version;
  tenant?: string;
  extensions?: string[];
}

// ===== Capabilities (v1) =====
export interface A2Av1ExtensionSpec {
  uri: string;
  description?: string;
  required?: boolean;
}

export interface A2Av1Capabilities {
  streaming?: boolean;
  pushNotifications?: boolean;
  stateTransitionHistory?: boolean;
  extendedAgentCard?: boolean;
  extensions?: A2Av1ExtensionSpec[];
}

// ===== Security schemes (v1) =====
export interface A2Av1APIKeySecurityScheme {
  type: "apiKey";
  in: "header" | "query" | "cookie";
  name: string;
  description?: string;
}

export interface A2Av1HTTPAuthSecurityScheme {
  type: "http";
  scheme: "basic" | "bearer" | "digest" | string;
  bearerFormat?: "JWT" | string;
  description?: string;
}

export interface A2Av1OAuthFlow {
  authorizationUrl?: string;
  tokenUrl?: string;
  refreshUrl?: string;
  scopes: Record<string, string>;
}

export interface A2Av1OAuthFlows {
  implicit?: A2Av1OAuthFlow;
  password?: A2Av1OAuthFlow;
  clientCredentials?: A2Av1OAuthFlow;
  authorizationCode?: A2Av1OAuthFlow;
  deviceCode?: A2Av1OAuthFlow;
}

export interface A2Av1OAuth2SecurityScheme {
  type: "oauth2";
  flows: A2Av1OAuthFlows;
  description?: string;
}

export interface A2Av1OpenIdConnectSecurityScheme {
  type: "openIdConnect";
  openIdConnectUrl: string;
  description?: string;
}

export interface A2Av1MutualTLSSecurityScheme {
  type: "mutualTLS";
  description?: string;
}

export type A2Av1SecurityScheme =
  | A2Av1APIKeySecurityScheme
  | A2Av1HTTPAuthSecurityScheme
  | A2Av1OAuth2SecurityScheme
  | A2Av1OpenIdConnectSecurityScheme
  | A2Av1MutualTLSSecurityScheme;

export type A2Av1SecurityRequirement = Record<string, string[]>;

// ===== Skill (v1) =====
export interface A2Av1Skill {
  id: string;
  name: string;
  description?: string;
  tags?: string[];
  examples?: string[];
  inputModes?: string[];
  outputModes?: string[];
  securityRequirements?: A2Av1SecurityRequirement[];
}

// ===== Agent Card (v1) =====
export interface A2Av1AgentProvider {
  organization: string;
  url?: string;
}

export interface A2Av1JwsSignature {
  protected: string;
  signature: string;
  header: { alg: string; kid?: string; jku?: string; x5u?: string; typ?: string };
}

export interface A2Av1AgentCard {
  protocolVersion: A2Av1Version;
  name: string;
  description?: string;
  url: string;
  preferredTransport?: A2Av1ProtocolBinding;
  supportedInterfaces: A2Av1Interface[];
  iconUrl?: string;
  provider?: A2Av1AgentProvider;
  version: string;
  documentationUrl?: string;
  capabilities: A2Av1Capabilities;
  securitySchemes?: Record<string, A2Av1SecurityScheme>;
  securityRequirements?: A2Av1SecurityRequirement[];
  defaultInputModes: string[];
  defaultOutputModes: string[];
  skills: A2Av1Skill[];
  // Multi-tenancy:
  tenant?: string;
  // JWS signature (RFC 7515 compact serialization)
  signatures?: A2Av1JwsSignature[];
}

// ===== Parts (members-based, no `kind` discriminator) =====
export interface A2Av1TextPart {
  text: string;
  metadata?: Record<string, unknown>;
}

export interface A2Av1FilePart {
  file: { name?: string; mimeType?: string; bytes?: string; uri?: string };
  metadata?: Record<string, unknown>;
}

export interface A2Av1DataPart {
  data: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export type A2Av1Part = A2Av1TextPart | A2Av1FilePart | A2Av1DataPart;

export function isTextPart(p: A2Av1Part): p is A2Av1TextPart {
  return typeof (p as A2Av1TextPart).text === "string";
}

export function isFilePart(p: A2Av1Part): p is A2Av1FilePart {
  return typeof (p as A2Av1FilePart).file === "object" && (p as A2Av1FilePart).file !== null;
}

export function isDataPart(p: A2Av1Part): p is A2Av1DataPart {
  return typeof (p as A2Av1DataPart).data === "object" && (p as A2Av1DataPart).data !== null;
}

// ===== Message (no `kind` discriminator) =====
export interface A2Av1Message {
  messageId: string;
  role: Role;
  parts: A2Av1Part[];
  contextId?: string;
  taskId?: string;
  metadata?: Record<string, unknown>;
  // ISO 8601 millisecond timestamp
  timestamp?: string;
  extensions?: string[];
}

// ===== Artifact (no `kind` discriminator) =====
export interface A2Av1Artifact {
  artifactId: string;
  name?: string;
  description?: string;
  parts: A2Av1Part[];
  metadata?: Record<string, unknown>;
  extensions?: string[];
}

// ===== Task (no `kind` discriminator) =====
export interface A2Av1TaskStatus {
  state: TaskState;
  message?: A2Av1Message;
  timestamp: string; // ISO 8601 ms
}

export interface A2Av1Task {
  id: string;
  contextId: string;
  status: A2Av1TaskStatus;
  history?: A2Av1Message[];
  artifacts?: A2Av1Artifact[];
  metadata?: Record<string, unknown>;
  extensions?: string[];
}

// ===== Streaming events (SSE) =====
export interface A2Av1TaskStatusUpdateEvent {
  taskId: string;
  contextId: string;
  status: A2Av1TaskStatus;
  final: boolean;
  metadata?: Record<string, unknown>;
}

export interface A2Av1TaskArtifactUpdateEvent {
  taskId: string;
  contextId: string;
  artifact: A2Av1Artifact;
  append?: boolean;
  lastChunk?: boolean;
  metadata?: Record<string, unknown>;
}

export type A2Av1StreamEvent =
  | { type: "task"; task: A2Av1Task }
  | { type: "message"; taskId: string; contextId: string; message: A2Av1Message }
  | { type: "status"; event: A2Av1TaskStatusUpdateEvent }
  | { type: "artifact"; event: A2Av1TaskArtifactUpdateEvent };

// ===== Push notification config =====
export interface A2Av1PushNotificationAuthenticationInfo {
  schemes: string[];
  credentials?: string;
}

export interface A2Av1PushNotificationConfig {
  id?: string;
  url: string;
  token?: string;
  authentication?: A2Av1PushNotificationAuthenticationInfo;
}

export interface A2Av1TaskPushNotificationConfig {
  taskId: string;
  taskPushNotificationConfig: A2Av1PushNotificationConfig;
  /** Legacy compatibility only. Do not emit on v1 HTTP responses. */
  pushNotificationConfig?: A2Av1PushNotificationConfig;
}

// ===== Send message =====
export interface A2Av1SendMessageConfiguration {
  acceptedOutputModes?: string[];
  historyLength?: number;
  taskPushNotificationConfig?: A2Av1PushNotificationConfig;
  /** Legacy compatibility input accepted for older clients. */
  pushNotificationConfig?: A2Av1PushNotificationConfig;
  blocking?: boolean;
}

export interface A2Av1SendMessageRequest {
  message: A2Av1Message;
  configuration?: A2Av1SendMessageConfiguration;
  metadata?: Record<string, unknown>;
}

export type A2Av1SendMessageResponse = A2Av1Task | A2Av1Message;

export function isTaskResponse(r: A2Av1SendMessageResponse): r is A2Av1Task {
  return typeof (r as A2Av1Task).id === "string" && typeof (r as A2Av1Task).contextId === "string" && typeof (r as A2Av1Task).status === "object";
}

export function isMessageResponse(r: A2Av1SendMessageResponse): r is A2Av1Message {
  return typeof (r as A2Av1Message).messageId === "string" && Array.isArray((r as A2Av1Message).parts);
}

// ===== GetTask =====
export interface A2Av1GetTaskRequest {
  historyLength?: number;
  metadata?: Record<string, unknown>;
}

// ===== ListTasks (cursor-based pagination) =====
export interface A2Av1ListTasksRequest {
  contextId?: string;
  state?: TaskState;
  pageSize?: number;
  pageToken?: string;
  historyLength?: number;
  tenant?: string;
}

export interface A2Av1ListTasksResponse {
  tasks: A2Av1Task[];
  nextPageToken?: string;
  totalSize?: number;
}

// ===== CancelTask =====
export interface A2Av1CancelTaskRequest {
  metadata?: Record<string, unknown>;
}

// ===== SubscribeToTask =====
export interface A2Av1SubscribeToTaskRequest {
  metadata?: Record<string, unknown>;
}

// ===== Push notification CRUD requests =====
export interface A2Av1CreateTaskPushNotificationConfigRequest {
  taskId: string;
  taskPushNotificationConfig: A2Av1PushNotificationConfig;
  /** Legacy compatibility input accepted for older clients. */
  pushNotificationConfig?: A2Av1PushNotificationConfig;
  metadata?: Record<string, unknown>;
}

export interface A2Av1GetTaskPushNotificationConfigRequest {
  taskId: string;
  configId: string;
  metadata?: Record<string, unknown>;
}

export interface A2Av1ListTaskPushNotificationConfigsRequest {
  taskId: string;
  metadata?: Record<string, unknown>;
}

export interface A2Av1ListTaskPushNotificationConfigsResponse {
  configs: A2Av1TaskPushNotificationConfig[];
}

export interface A2Av1DeleteTaskPushNotificationConfigRequest {
  taskId: string;
  configId: string;
  metadata?: Record<string, unknown>;
}

// ===== GetExtendedAgentCard =====
export interface A2Av1GetExtendedAgentCardRequest {
  metadata?: Record<string, unknown>;
}

// ===== Multi-tenancy helper =====
export interface A2Av1TenantContext {
  tenant: string;
}

// ===== Helper: terminal task states =====
export function isTerminalV1State(s: TaskState): boolean {
  return (
    s === "TASK_STATE_COMPLETED" ||
    s === "TASK_STATE_FAILED" ||
    s === "TASK_STATE_REJECTED" ||
    s === "TASK_STATE_CANCELED"
  );
}

// ===== Helper: build a server-generated task id (UUID v4) =====
export function newServerTaskId(): string {
  return crypto.randomUUID();
}
