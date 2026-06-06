import {
  type EncryptedPayload,
  type SessionKey,
  decryptWithSessionKey,
  encryptWithSessionKey,
} from "./AnpCrypto.js";

export interface AnpMessage {
  id: string;
  type: string;
  from: string;
  to: string;
  threadId?: string;
  createdTime: number;
  expiresTime?: number;
  body: Record<string, unknown>;
  attachments?: Array<{
    id: string;
    mediaType: string;
    data?: { base64: string };
    filename?: string;
    size?: number;
  }>;
}

export interface EncryptedAnpMessage {
  id: string;
  from: string;
  to: string;
  type: "application/anp+encrypted";
  encrypted: EncryptedPayload;
  threadId?: string;
  createdTime: number;
  expiresTime?: number;
}

export interface SignedAnpMessage {
  id: string;
  from: string;
  to: string;
  type: "application/anp+signed";
  payload: Record<string, unknown>;
  signature: {
    type: "DataIntegrityProof";
    cryptosuite: "eddsa-jcs-2022";
    verificationMethod: string;
    created: string;
    proofPurpose: "assertionMethod";
    proofValue: string;
  };
  threadId?: string;
  createdTime: number;
}

export type EnvelopedAnpMessage = EncryptedAnpMessage | SignedAnpMessage;

export function encryptMessage(
  message: AnpMessage,
  sessionKey: SessionKey,
  secretKeyId: string,
): EncryptedAnpMessage {
  const plaintext = Buffer.from(JSON.stringify(message), "utf8");
  const encrypted = encryptWithSessionKey(plaintext, sessionKey, secretKeyId);
  return {
    id: message.id,
    from: message.from,
    to: message.to,
    type: "application/anp+encrypted",
    encrypted,
    threadId: message.threadId,
    createdTime: message.createdTime,
    expiresTime: message.expiresTime,
  };
}

export function decryptMessage(
  enveloped: EncryptedAnpMessage,
  sessionKey: SessionKey,
  expectedSecretKeyId: string,
): AnpMessage {
  if (enveloped.encrypted.secretKeyId !== expectedSecretKeyId) {
    throw new Error("SecretKeyId mismatch");
  }
  const plaintext = decryptWithSessionKey(enveloped.encrypted, sessionKey);
  return JSON.parse(plaintext.toString("utf8")) as AnpMessage;
}

export interface SignMessageInput {
  message: Omit<AnpMessage, "createdTime">;
  proof: {
    type: "DataIntegrityProof";
    cryptosuite: "eddsa-jcs-2022";
    verificationMethod: string;
    created: string;
    proofPurpose: "assertionMethod";
    proofValue: string;
  };
}

export function signMessage(input: SignMessageInput): SignedAnpMessage {
  return {
    id: input.message.id,
    from: input.message.from,
    to: input.message.to,
    type: "application/anp+signed",
    payload: { ...input.message, createdTime: Date.now() } as Record<string, unknown>,
    signature: input.proof,
    threadId: input.message.threadId,
    createdTime: Date.now(),
  };
}

export interface MessageThread {
  threadId: string;
  participants: string[];
  messages: AnpMessage[];
  createdAt: string;
  lastActivity: string;
}

export function appendToThread(
  thread: MessageThread,
  message: AnpMessage,
): MessageThread {
  return {
    ...thread,
    messages: [...thread.messages, message],
    lastActivity: new Date().toISOString(),
  };
}

export function isExpired(message: AnpMessage, now: number = Date.now()): boolean {
  if (!message.expiresTime) return false;
  return now > message.expiresTime;
}
