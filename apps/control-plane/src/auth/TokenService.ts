import { createHash, randomBytes } from "node:crypto";
import jwt, { type JwtPayload, type SignOptions } from "jsonwebtoken";
import { loadConfig } from "../config.js";
import type { AccessTokenClaims, AuthContext, DeviceTokenClaims, DeviceAuthContext } from "../types/cloud.js";

export function issueAccessToken(input: {
  userId: string;
  orgId: string;
  email: string;
  displayName: string;
}): { token: string; expiresIn: number } {
  const cfg = loadConfig();
  const now = Math.floor(Date.now() / 1000);
  const claims: Omit<AccessTokenClaims, "iat" | "exp" | "iss"> = {
    sub: input.userId,
    org: input.orgId,
    email: input.email,
    display_name: input.displayName,
    scope: "user"
  };
  const options: SignOptions = {
    issuer: cfg.TOKEN_ISSUER,
    expiresIn: cfg.ACCESS_TOKEN_TTL_SECONDS
  };
  const token = jwt.sign(claims, cfg.JWT_ACCESS_SECRET, options);
  return { token, expiresIn: cfg.ACCESS_TOKEN_TTL_SECONDS };
}

export function issueDeviceToken(input: {
  agentInstanceId: string;
  agentId: string;
  deviceId: string;
  userId: string;
  orgId: string;
}): { token: string; expiresIn: number; tokenHash: string } {
  const cfg = loadConfig();
  const now = Math.floor(Date.now() / 1000);
  const claims: Omit<DeviceTokenClaims, "iat" | "exp" | "iss"> = {
    sub: input.agentInstanceId,
    org: input.orgId,
    user: input.userId,
    device: input.deviceId,
    agent: input.agentId,
    scope: "device"
  };
  const options: SignOptions = {
    issuer: cfg.TOKEN_ISSUER,
    expiresIn: cfg.ACCESS_TOKEN_TTL_SECONDS
  };
  const token = jwt.sign(claims, cfg.JWT_ACCESS_SECRET, options);
  return { token, expiresIn: cfg.ACCESS_TOKEN_TTL_SECONDS, tokenHash: hashOpaqueToken(token) };
}

export function verifyAccessToken(token: string): AccessTokenClaims {
  const cfg = loadConfig();
  const decoded = jwt.verify(token, cfg.JWT_ACCESS_SECRET, { issuer: cfg.TOKEN_ISSUER });
  if (typeof decoded === "string") {
    throw new Error("Invalid token payload");
  }
  const payload = decoded as JwtPayload & Partial<AccessTokenClaims>;
  if (!payload.sub || !payload.org || !payload.scope) {
    throw new Error("Missing required token claims");
  }
  return {
    sub: String(payload.sub),
    org: String(payload.org),
    email: String(payload.email ?? ""),
    display_name: String(payload.display_name ?? ""),
    scope: String(payload.scope),
    iat: Number(payload.iat ?? 0),
    exp: Number(payload.exp ?? 0),
    iss: String(payload.iss ?? cfg.TOKEN_ISSUER)
  };
}

export function verifyDeviceToken(token: string): DeviceTokenClaims {
  const cfg = loadConfig();
  const decoded = jwt.verify(token, cfg.JWT_ACCESS_SECRET, { issuer: cfg.TOKEN_ISSUER });
  if (typeof decoded === "string") {
    throw new Error("Invalid device token payload");
  }
  const payload = decoded as JwtPayload & Partial<DeviceTokenClaims>;
  if (!payload.sub || !payload.org || payload.scope !== "device") {
    throw new Error("Invalid device token claims");
  }
  return {
    sub: String(payload.sub),
    org: String(payload.org),
    user: String(payload.user ?? ""),
    device: String(payload.device ?? ""),
    agent: String(payload.agent ?? ""),
    scope: "device",
    iat: Number(payload.iat ?? 0),
    exp: Number(payload.exp ?? 0),
    iss: String(payload.iss ?? cfg.TOKEN_ISSUER)
  };
}

export function toAuthContext(claims: AccessTokenClaims): AuthContext {
  return {
    orgId: claims.org,
    userId: claims.sub,
    email: claims.email,
    displayName: claims.display_name,
    scope: claims.scope
  };
}

export function toDeviceAuthContext(claims: DeviceTokenClaims): DeviceAuthContext {
  return {
    orgId: claims.org,
    userId: claims.user,
    deviceId: claims.device,
    agentId: claims.agent,
    agentInstanceId: claims.sub,
    scope: "device"
  };
}

export function generateOpaqueToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashOpaqueToken(token) };
}

export function hashOpaqueToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
