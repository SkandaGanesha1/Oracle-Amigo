import { randomUUID } from "node:crypto";
import type {
  A2Av1TaskPushNotificationConfig,
  A2Av1PushNotificationConfig,
  A2Av1PushNotificationAuthenticationInfo
} from "./types.js";

/**
 * A2A v1.0.0 push notification store with delivery.
 *
 * Per the A2A v1 spec, push notification configs are created via
 * `CreateTaskPushNotificationConfig` and used to deliver task updates
 * to a webhook URL.
 *
 * This is an in-memory implementation; production deployments should
 * back it with persistent storage.
 */
export class A2Av1PushNotificationStore {
  private configs = new Map<string, A2Av1TaskPushNotificationConfig[]>();

  /** Save a config; assigns an id if not provided. */
  set(taskId: string, config: A2Av1PushNotificationConfig): A2Av1TaskPushNotificationConfig {
    const id = config.id ?? randomUUID();
    const stored: A2Av1TaskPushNotificationConfig = {
      taskId,
      pushNotificationConfig: { ...config, id }
    };
    const list = this.configs.get(taskId) ?? [];
    list.push(stored);
    this.configs.set(taskId, list);
    return stored;
  }

  /** Get a single config by taskId + configId. */
  get(taskId: string, configId: string): A2Av1TaskPushNotificationConfig | null {
    const list = this.configs.get(taskId) ?? [];
    return list.find((c) => c.pushNotificationConfig.id === configId) ?? null;
  }

  /** List all configs for a task. */
  list(taskId: string): A2Av1TaskPushNotificationConfig[] {
    return this.configs.get(taskId) ?? [];
  }

  /** Delete a config; returns true if removed. */
  delete(taskId: string, configId: string): boolean {
    const list = this.configs.get(taskId) ?? [];
    const idx = list.findIndex((c) => c.pushNotificationConfig.id === configId);
    if (idx < 0) return false;
    list.splice(idx, 1);
    this.configs.set(taskId, list);
    return true;
  }

  /** Total count of stored configs. */
  size(): number {
    let n = 0;
    for (const list of this.configs.values()) n += list.length;
    return n;
  }
}

/**
 * Build the HTTP request headers for a push notification delivery.
 */
export function buildPushNotificationHeaders(
  config: A2Av1PushNotificationConfig,
  body: string
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/a2a+json",
    "A2A-Version": "1.0",
    "Content-Length": String(Buffer.byteLength(body, "utf8"))
  };
  if (config.token) {
    headers["X-A2A-Notification-Token"] = config.token;
  }
  const auth = config.authentication;
  if (auth) {
    if (auth.schemes.includes("bearer") && auth.credentials) {
      headers.Authorization = `Bearer ${auth.credentials}`;
    } else if (auth.schemes.includes("basic") && auth.credentials) {
      headers.Authorization = `Basic ${Buffer.from(auth.credentials, "utf8").toString("base64")}`;
    }
  }
  return headers;
}

export interface PushNotificationDeliveryResult {
  ok: boolean;
  statusCode?: number;
  error?: string;
  configId: string;
  url: string;
}

/**
 * Deliver a JSON body to all registered webhook URLs for a task.
 *
 * Per the A2A v1 spec, push notifications are HTTPS POST requests
 * with the task update payload as the body. Bearer/basic auth and
 * opaque tokens are supported.
 */
export async function deliverToTask(
  store: A2Av1PushNotificationStore,
  taskId: string,
  body: string,
  fetchImpl: typeof fetch = fetch
): Promise<PushNotificationDeliveryResult[]> {
  const configs = store.list(taskId);
  const results: PushNotificationDeliveryResult[] = [];
  for (const c of configs) {
    const url = c.pushNotificationConfig.url;
    const headers = buildPushNotificationHeaders(c.pushNotificationConfig, body);
    try {
      const res = await fetchImpl(url, { method: "POST", headers, body });
      results.push({
        ok: res.ok,
        statusCode: res.status,
        configId: c.pushNotificationConfig.id ?? "",
        url
      });
    } catch (err) {
      results.push({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        configId: c.pushNotificationConfig.id ?? "",
        url
      });
    }
  }
  return results;
}

export type { A2Av1TaskPushNotificationConfig, A2Av1PushNotificationConfig, A2Av1PushNotificationAuthenticationInfo };
