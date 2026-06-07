export class ApiError extends Error {
  status: number;
  payload: unknown;
  constructor(message: string, status: number, payload: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
  }
}

export interface ApiOptions {
  signal?: AbortSignal;
  base?: string;
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  body?: unknown;
}

function apiBase(): string {
  if (typeof window === "undefined") return "";
  const override = (window as unknown as { __ADMIN_API_BASE__?: string }).__ADMIN_API_BASE__;
  return typeof override === "string" ? override.replace(/\/$/, "") : "";
}

function dispatchApiError(status: number, message: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("oracle-amigo.admin.api-error", { detail: { status, message } }));
}

export async function adminFetch<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const base = options.base ?? apiBase();
  const url = `${base}${path}`;
  const method = options.method ?? "GET";
  const headers: Record<string, string> = { Accept: "application/json" };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      credentials: "same-origin",
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal
    });
  } catch (networkError) {
    const message = networkError instanceof Error ? networkError.message : "Network error";
    dispatchApiError(0, message);
    throw new ApiError(message, 0, null);
  }

  let body: unknown = null;
  const text = await response.text();
  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  if (!response.ok) {
    const message =
      body && typeof body === "object" && "message" in body && typeof (body as { message: unknown }).message === "string"
        ? (body as { message: string }).message
        : `Request failed with HTTP ${response.status}`;
    dispatchApiError(response.status, message);
    throw new ApiError(message, response.status, body);
  }
  return body as T;
}
