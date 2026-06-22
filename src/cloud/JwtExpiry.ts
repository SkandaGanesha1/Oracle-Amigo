export function isJwtExpiringSoon(token: string, leewaySeconds = 60): boolean {
  try {
    const [, payload] = token.split(".");
    if (!payload) return true;
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { exp?: unknown };
    const exp = typeof parsed.exp === "number" ? parsed.exp : 0;
    return exp * 1000 <= Date.now() + leewaySeconds * 1000;
  } catch {
    return true;
  }
}
