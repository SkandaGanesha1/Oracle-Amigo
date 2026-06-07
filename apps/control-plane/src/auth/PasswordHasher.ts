import { hash, verify, Algorithm } from "@node-rs/argon2";
import { loadConfig } from "../config.js";

const PASSWORD_HASH_ALGO = "argon2id";

export async function hashPassword(plaintext: string): Promise<{ hash: string; algo: string }> {
  const cfg = loadConfig();
  const hashed = await hash(plaintext, {
    algorithm: Algorithm.Argon2id,
    memoryCost: cfg.ARGON2_MEMORY_COST,
    timeCost: cfg.ARGON2_TIME_COST,
    parallelism: cfg.ARGON2_PARALLELISM
  });
  return { hash: hashed, algo: PASSWORD_HASH_ALGO };
}

export async function verifyPassword(plaintext: string, storedHash: string): Promise<boolean> {
  try {
    return await verify(storedHash, plaintext);
  } catch {
    return false;
  }
}

export function validatePasswordStrength(plaintext: string): { ok: boolean; reason?: string } {
  if (plaintext.length < 8) return { ok: false, reason: "Password must be at least 8 characters" };
  if (plaintext.length > 256) return { ok: false, reason: "Password too long" };
  return { ok: true };
}
