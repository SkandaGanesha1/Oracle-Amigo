import { createHmac, timingSafeEqual } from "node:crypto";
import { lookup } from "node:dns/promises";
import type { FastifyReply, FastifyRequest } from "fastify";

const PRIVATE_HOSTNAMES = new Set(["localhost", "localhost.localdomain"]);
const METADATA_HOSTS = new Set(["169.254.169.254", "metadata.google.internal"]);

export function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function readBearerToken(req: FastifyRequest): string | null {
  const header = req.headers.authorization;
  if (typeof header !== "string") return null;
  const [scheme, value] = header.split(" ", 2);
  if (scheme?.toLowerCase() !== "bearer" || !value) return null;
  return value.trim();
}

export async function requireLocalApiToken(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const expected = process.env.LOCAL_AGENT_API_TOKEN;
  if (!expected && process.env.NODE_ENV === "test") return;
  const token = readBearerToken(req) ?? (typeof req.headers["x-local-agent-token"] === "string" ? req.headers["x-local-agent-token"] : null);
  if (!expected || expected.length < 32 || !token || !constantTimeEqual(token, expected)) {
    await reply.code(401).send({ error: "UNAUTHORIZED", message: "Local agent API token is required" });
  }
}

export function signApprovalCallback(input: {
  approvalId: string;
  taskId: string;
  action: string;
  nonce: string;
  secret?: string;
}): string {
  const secret = input.secret ?? process.env.APPROVAL_CALLBACK_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("APPROVAL_CALLBACK_SECRET must be at least 32 characters");
  }
  return createHmac("sha256", secret)
    .update(`${input.approvalId}|${input.taskId}|${input.action}|${input.nonce}`)
    .digest("hex");
}

export function verifyApprovalCallbackSignature(input: {
  approvalId: string;
  taskId: string;
  action: string;
  nonce: string;
  signature: string;
  secret?: string;
}): boolean {
  if (!/^[a-f0-9]{64}$/i.test(input.signature)) return false;
  const exact = signApprovalCallback(input);
  const notificationWide = signApprovalCallback({ ...input, action: "notification", secret: input.secret });
  const provided = input.signature.toLowerCase();
  return constantTimeEqual(provided, exact) || constantTimeEqual(provided, notificationWide);
}

export function assertPublicHttpsUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:") {
    throw new Error("URL must use HTTPS");
  }
  if (url.username || url.password) {
    throw new Error("URL credentials are not allowed");
  }
  if (isPrivateOrMetadataHost(url.hostname)) {
    throw new Error(`URL host is not allowed: ${url.hostname}`);
  }
  return url.toString();
}

export async function assertPublicHttpsUrlResolved(value: string): Promise<string> {
  const normalized = assertPublicHttpsUrl(value);
  const url = new URL(normalized);
  const answers = await lookup(url.hostname, { all: true, verbatim: true });
  if (answers.length === 0 || answers.some((answer) => isPrivateOrMetadataHost(answer.address))) {
    throw new Error(`URL host resolves to a private or metadata address: ${url.hostname}`);
  }
  return normalized;
}

export function isPrivateOrMetadataHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (!host) return true;
  if (PRIVATE_HOSTNAMES.has(host) || METADATA_HOSTS.has(host) || isLoopbackHost(host)) return true;
  if (isIpv4Private(host) || isIpv6Private(host)) return true;
  return false;
}

function isLoopbackHost(host: string): boolean {
  const normalized = normalizeHostForAuth(host);
  return (
    normalized === "localhost" ||
    normalized === "localhost.localdomain" ||
    normalized === "::1" ||
    normalized === "0:0:0:0:0:0:0:1" ||
    normalized === "::ffff:127.0.0.1" ||
    normalized.startsWith("127.")
  );
}

function normalizeHostForAuth(host: string): string {
  const trimmed = host.trim().toLowerCase();
  if (!trimmed) return "";
  if (trimmed.startsWith("[") && trimmed.includes("]")) {
    return trimmed.slice(1, trimmed.indexOf("]"));
  }
  if (trimmed.startsWith("::ffff:")) return trimmed;
  if (trimmed.includes(":") && !trimmed.includes("::")) {
    return trimmed.split(":", 1)[0] ?? "";
  }
  return trimmed;
}

function isIpv4Private(host: string): boolean {
  const parts = host.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function isIpv6Private(host: string): boolean {
  return host === "::" || host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:");
}
