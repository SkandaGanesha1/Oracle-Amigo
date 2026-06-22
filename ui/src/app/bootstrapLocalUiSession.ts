import { bootstrapLocalUiSession } from "../api/localUiSessionStore";

export const BOOTSTRAP_TIMEOUT_MS = 8000;

export async function bootstrapLocalUiSessionWithTimeout(timeoutMs = BOOTSTRAP_TIMEOUT_MS): Promise<"ready" | "failed" | "timeout"> {
  let timer: number | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = window.setTimeout(() => resolve("timeout"), timeoutMs);
  });
  const result = await Promise.race([
    bootstrapLocalUiSession().then((ok) => (ok ? "ready" as const : "failed" as const)),
    timeout,
  ]);
  if (timer !== undefined) window.clearTimeout(timer);
  return result;
}

