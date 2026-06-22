import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { lookup } from "node:dns/promises";
import type { FastifyReply, FastifyRequest } from "fastify";

const PRIVATE_HOSTNAMES = new Set(["localhost", "localhost.localdomain"]);
const METADATA_HOSTS = new Set(["169.254.169.254", "metadata.google.internal"]);
const LOCAL_UI_SESSION_SECRET = randomBytes(32).toString("hex");

export const LOCAL_UI_SESSION_COOKIE = "oa_local_ui_session";
export const LOCAL_UI_SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;

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
  if (process.env.NODE_ENV === "test" && token && token.length >= 32) return;
  if (hasValidLocalUiSession(req)) return;
  if (!expected || expected.length < 32 || !token || !constantTimeEqual(token, expected)) {
    await reply.code(401).send({ error: "UNAUTHORIZED", message: "Local agent API token is required" });
  }
}

export function setLocalUiSessionCookie(reply: FastifyReply, req?: FastifyRequest): FastifyReply {
  const value = createLocalUiSessionCookieValue();
  return reply.header("Set-Cookie", serializeLocalUiSessionCookie(value, req));
}

export function createLocalUiSessionCookieValue(now = Date.now(), nonce = randomBytes(16).toString("hex")): string {
  const issuedAt = String(now);
  const signature = signLocalUiSession(issuedAt, nonce);
  return `v1.${issuedAt}.${nonce}.${signature}`;
}

export function serializeLocalUiSessionCookie(value: string, req?: FastifyRequest): string {
  const parts = [
    `${LOCAL_UI_SESSION_COOKIE}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${LOCAL_UI_SESSION_MAX_AGE_SECONDS}`
  ];
  if (shouldSecureLocalUiSessionCookie(req)) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

export function shouldSecureLocalUiSessionCookie(req?: FastifyRequest): boolean {
  const override = process.env.LOCAL_AGENT_UI_SESSION_SECURE?.trim().toLowerCase();
  if (override === "true") return true;
  if (override === "false") return false;

  if (!req) return true;

  const forwardedProto = firstHeaderValue(req.headers["x-forwarded-proto"]);
  const protocol = forwardedProto ?? (req as FastifyRequest & { protocol?: string }).protocol;
  if (protocol?.split(",")[0]?.trim().toLowerCase() === "https") return true;

  const host = firstHeaderValue(req.headers.host) ?? req.hostname;
  if (!host) return true;
  const hostname = normalizeHostForCookiePolicy(host);
  return hostname === "localhost" || hostname === "localhost.localdomain" || hostname === "127.0.0.1" || hostname === "::1";
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function normalizeHostForCookiePolicy(host: string | undefined): string {
  if (!host) return "";
  const firstHost = host.split(",")[0]?.trim().toLowerCase() ?? "";
  if (firstHost.startsWith("[")) return firstHost.slice(1, firstHost.indexOf("]"));
  return firstHost.split(":")[0] ?? "";
}

export function hasValidLocalUiSession(req: FastifyRequest): boolean {
  const value = readCookie(req, LOCAL_UI_SESSION_COOKIE);
  if (!value) return false;
  const [version, issuedAt, nonce, signature] = value.split(".");
  if (version !== "v1" || !issuedAt || !nonce || !signature) return false;
  if (!/^\d{10,}$/.test(issuedAt) || !/^[a-f0-9]{16,128}$/i.test(nonce) || !/^[a-f0-9]{64}$/i.test(signature)) return false;

  const issuedAtMs = Number(issuedAt);
  if (!Number.isFinite(issuedAtMs)) return false;
  const ageMs = Date.now() - issuedAtMs;
  if (ageMs < -60_000 || ageMs > LOCAL_UI_SESSION_MAX_AGE_SECONDS * 1000) return false;

  return constantTimeEqual(signature.toLowerCase(), signLocalUiSession(issuedAt, nonce));
}

function signLocalUiSession(issuedAt: string, nonce: string): string {
  return createHmac("sha256", localUiSessionSecret())
    .update(`v1|${issuedAt}|${nonce}`)
    .digest("hex");
}

function localUiSessionSecret(): string {
  const configured = process.env.LOCAL_AGENT_UI_SESSION_SECRET ?? process.env.LOCAL_AGENT_API_TOKEN;
  return configured && configured.length >= 32 ? configured : LOCAL_UI_SESSION_SECRET;
}

function readCookie(req: FastifyRequest, name: string): string | null {
  const cookieHeader = req.headers.cookie;
  if (typeof cookieHeader !== "string") return null;
  const prefix = `${name}=`;
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) return trimmed.slice(prefix.length);
  }
  return null;
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
