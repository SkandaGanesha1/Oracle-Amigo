const SAFE_LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);

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
