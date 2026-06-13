const SAFE_LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);
const SAFE_DATA_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const MAX_DATA_URL_LENGTH = 5 * 1024 * 1024;

export function safeExternalHref(raw: string | undefined | null): string | undefined {
  const value = raw?.trim();
  if (!value) return undefined;

  if (value.startsWith("//")) return undefined;
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  if (value.startsWith("#")) return value;

  try {
    const base = typeof window !== "undefined" ? window.location.origin : "http://localhost";
    const parsed = new URL(value, base);
    return SAFE_LINK_PROTOCOLS.has(parsed.protocol) ? parsed.href : undefined;
  } catch {
    return undefined;
  }
}

export function safeFaviconDomainUrl(raw: string | undefined | null): string {
  return safeExternalHref(raw) ?? "";
}

export function safeMediaSrc(raw: string | undefined | null): string | undefined {
  const value = raw?.trim();
  if (!value) return undefined;

  if (value.startsWith("blob:")) return value;
  if (value.startsWith("//")) return undefined;
  if (value.startsWith("/") && !value.startsWith("//")) return value;

  const dataMatch = /^data:([^;,]+);base64,/i.exec(value);
  if (dataMatch) {
    const mediaType = dataMatch[1]?.toLowerCase();
    return mediaType && SAFE_DATA_IMAGE_TYPES.has(mediaType) && value.length <= MAX_DATA_URL_LENGTH
      ? value
      : undefined;
  }

  try {
    const base = typeof window !== "undefined" ? window.location.origin : "http://localhost";
    const parsed = new URL(value, base);
    return parsed.protocol === "https:" ? parsed.href : undefined;
  } catch {
    return undefined;
  }
}
