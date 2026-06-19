import { markLocalUiSessionBlocked, markLocalUiSessionReady, markLocalUiSessionRecovering } from "./localUiSessionStore";

export class ApiRequestError extends Error {
  constructor(
    message: string,
    public status: number,
    public details: unknown
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

let localSessionRefresh: Promise<void> | null = null;

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  return requestWithLocalSessionRecovery<T>(path, init, true);
}

async function requestWithLocalSessionRecovery<T>(path: string, init: RequestInit | undefined, canRefreshLocalSession: boolean): Promise<T> {
  const hasBody = init?.body != null;
  const headers = withLocalAgentAuth(init?.headers);
  if (hasBody && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(path, {
    ...init,
    headers,
    credentials: "include"
  });
  if (!response.ok) {
    const details = await readResponseBody(response);
    const message =
      details && typeof details === "object" && "message" in details && typeof details.message === "string"
        ? details.message
        : details && typeof details === "object" && "error" in details && typeof details.error === "string"
          ? details.error
          : `HTTP ${response.status}`;
    if (canRefreshLocalSession && isLocalUiSessionUnauthorized(path, response.status, message, details)) {
      await refreshLocalUiSessionOnce();
      return requestWithLocalSessionRecovery<T>(path, init, false);
    }
    if (!canRefreshLocalSession && isLocalUiSessionUnauthorized(path, response.status, message, details)) {
      markLocalUiSessionBlocked(message);
    }
    throw new ApiRequestError(message, response.status, details);
  }

  if (path !== "/local-ui-session") markLocalUiSessionReady();
  return readResponseBody(response) as Promise<T>;
}

export const localAgentClient = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) => request<T>(path, { method: "POST", body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) => request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) => request<T>(path, { method: "PUT", body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" })
};

export function withLocalAgentAuth(headersInit?: HeadersInit): Headers {
  return new Headers(headersInit);
}

function isLocalUiSessionUnauthorized(path: string, status: number, message: string, details: unknown): boolean {
  if (status !== 401 || path === "/local-ui-session") return false;
  if (!details || typeof details !== "object") return false;
  const error = "error" in details ? String((details as { error?: unknown }).error ?? "") : "";
  // Trigger session recovery for any local-agent UNAUTHORIZED response.
  // This covers: expired session cookie, missing LOCAL_AGENT_API_TOKEN, or
  // a server restart that invalidated the in-memory session secret.
  return error === "UNAUTHORIZED";
}

async function refreshLocalUiSessionOnce(): Promise<void> {
  if (!localSessionRefresh) {
    markLocalUiSessionRecovering();
    localSessionRefresh = fetch("/local-ui-session", { credentials: "include" })
      .then(async (response) => {
        if (!response.ok) {
          const details = await readResponseBody(response);
          const message =
            details && typeof details === "object" && "message" in details && typeof details.message === "string"
              ? details.message
              : `HTTP ${response.status}`;
          markLocalUiSessionBlocked(message);
          throw new ApiRequestError(message, response.status, details);
        }
        await readResponseBody(response);
        markLocalUiSessionReady();
      })
      .catch((error) => {
        markLocalUiSessionBlocked(error instanceof Error ? error.message : "Local UI session refresh failed.");
        throw error;
      })
      .finally(() => {
        localSessionRefresh = null;
      });
  }
  return localSessionRefresh;
}

async function readResponseBody(response: Response): Promise<unknown> {
  if (response.status === 204 || response.status === 205) return undefined;

  const text = await response.text();
  if (!text) return undefined;

  const contentType = response.headers.get("Content-Type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
