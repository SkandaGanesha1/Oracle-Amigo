import { createHash, generateKeyPairSync, randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { getDb } from "../db/connection.js";

export type LocalIdentity = {
  agentId: string;
  deviceId: string;
  did: string;
  publicKey: string;  // hex-encoded
  privateKeyRef: string; // path to PEM file
  /** Optional in-memory PEM (for tests / in-process identities). When set, takes precedence over `privateKeyRef`. */
  privateKeyPem?: string;
};

function keysDir(): string {
  if (process.env.LOCALAPPDATA) return join(process.env.LOCALAPPDATA, "AgenticApp", "keys");
  return join(homedir(), ".agentic-app", "keys");
}

export function generateOrLoadIdentity(displayName = "Local User", dbPath?: string): LocalIdentity {
  const db = getDb(dbPath);
  const existing = db.prepare("SELECT * FROM local_profiles LIMIT 1").get() as Record<string, string> | undefined;
  if (existing) {
    return {
      agentId: existing.agent_id,
      deviceId: existing.device_id,
      did: existing.did,
      publicKey: existing.public_key,
      privateKeyRef: existing.private_key_ref,
    };
  }

  const agentId = randomUUID();
  const deviceId = randomUUID();

  const { publicKey, privateKey } = generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  // Derive raw public key bytes for DID
  const pubKeyHex = publicKeyPemToHex(publicKey);
  const did = `did:key:z${base64url(hexToBuffer(pubKeyHex))}`;

  const keyDir = keysDir();
  mkdirSync(keyDir, { recursive: true });
  const privateKeyRef = join(keyDir, `${agentId}.pem`);
  writeFileSync(privateKeyRef, privateKey, { mode: 0o600 });
  // On non-Windows: enforce strict permissions (TODO: Windows Credential Manager)
  if (process.platform !== "win32") {
    try { chmodSync(privateKeyRef, 0o600); } catch { /* ignore */ }
  }

  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO local_profiles (user_display_name, agent_id, device_id, did, public_key, private_key_ref, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(displayName, agentId, deviceId, did, pubKeyHex, privateKeyRef, now, now);

  return { agentId, deviceId, did, publicKey: pubKeyHex, privateKeyRef };
}

export function loadPrivateKeyPem(identity: LocalIdentity): string {
  if (identity.privateKeyPem) return identity.privateKeyPem;
  return readFileSync(identity.privateKeyRef, "utf8");
}

function publicKeyPemToHex(pem: string): string {
  // Extract raw bytes from SPKI PEM — last 32 bytes are the Ed25519 public key
  const b64 = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Buffer.from(b64, "base64");
  return der.slice(-32).toString("hex");
}

function hexToBuffer(hex: string): Buffer {
  return Buffer.from(hex, "hex");
}

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}
