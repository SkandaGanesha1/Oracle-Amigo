import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export type SignedFileRouteKind = "thumbnail" | "view";

export interface SignedFileRouteInput {
  fileId: string;
  kind: SignedFileRouteKind;
  variant?: "360" | "720";
  expires: number;
}

const processSecret = randomBytes(32).toString("hex");

function signingSecret(): string {
  return process.env.FILE_PREVIEW_SIGNING_SECRET && process.env.FILE_PREVIEW_SIGNING_SECRET.length >= 32
    ? process.env.FILE_PREVIEW_SIGNING_SECRET
    : processSecret;
}

function payload(input: SignedFileRouteInput): string {
  return [input.fileId, input.kind, input.variant ?? "", String(input.expires)].join(":");
}

export function signFileRoute(input: SignedFileRouteInput): string {
  return createHmac("sha256", signingSecret()).update(payload(input)).digest("base64url");
}

export function verifyFileRoute(input: SignedFileRouteInput, signature: string | undefined): boolean {
  if (!signature || !Number.isFinite(input.expires) || input.expires < Math.floor(Date.now() / 1000)) {
    return false;
  }
  const expected = Buffer.from(signFileRoute(input));
  const actual = Buffer.from(signature);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function signedStorageUrl(input: Omit<SignedFileRouteInput, "expires">, ttlSeconds: number): string {
  const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = signFileRoute({ ...input, expires });
  const params = new URLSearchParams({ expires: String(expires), sig });
  if (input.variant) params.set("variant", input.variant);
  const route = input.kind === "thumbnail" ? "thumbnail" : "view";
  return `/storage/files/${encodeURIComponent(input.fileId)}/${route}?${params.toString()}`;
}
