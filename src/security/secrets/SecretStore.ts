export interface SecretStore {
  readonly kind: string;
  get(name: string): string | null;
  set(name: string, value: string): void;
  delete(name: string): void;
  list?(prefix?: string): string[];
  clearProfile(profileId: string): void;
}

export const SECRET_REF_PREFIX = "secret://";

export function toSecretRef(name: string): string {
  return `${SECRET_REF_PREFIX}${name}`;
}

export function fromSecretRef(value: string): string | null {
  return value.startsWith(SECRET_REF_PREFIX) ? value.slice(SECRET_REF_PREFIX.length) : null;
}

export function normalizeSecretName(name: string): string {
  const normalized = name.trim().replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/|\/$/g, "");
  if (!normalized || normalized.includes("..") || normalized.startsWith(".") || /[<>:"|?*\u0000-\u001f]/.test(normalized)) {
    throw new Error("Invalid secret name");
  }
  return normalized;
}

export function profileSecretPrefix(profileId: string): string {
  return `profile/${normalizeSecretName(profileId)}`;
}
