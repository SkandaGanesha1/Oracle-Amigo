import { createHash } from "node:crypto";

export interface AnpKeyRotationMetadata {
  keyId: string;
  createdAt: string;
  algorithm: "aes-128-gcm" | "aes-256-gcm";
  rotateAfter: string;
}

export class AnpKeyRotationService {
  constructor(private readonly rotationDays = 30) {}

  createMetadata(key: Buffer, createdAt = new Date()): AnpKeyRotationMetadata {
    const algorithm = key.length === 16 ? "aes-128-gcm" : key.length === 32 ? "aes-256-gcm" : null;
    if (!algorithm) {
      throw new Error("ANP rotation metadata only supports 16-byte and 32-byte session keys");
    }
    const rotateAfter = new Date(createdAt.getTime() + this.rotationDays * 24 * 60 * 60 * 1000);
    return {
      keyId: createHash("sha256").update(key).digest("hex"),
      createdAt: createdAt.toISOString(),
      algorithm,
      rotateAfter: rotateAfter.toISOString()
    };
  }

  shouldRotate(metadata: Pick<AnpKeyRotationMetadata, "rotateAfter">, now = new Date()): boolean {
    return Date.parse(metadata.rotateAfter) <= now.getTime();
  }
}
