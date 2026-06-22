import { createLogger } from "../logging/Logger.js";

const logger = createLogger();

export type NotifyKind = "approval" | "chat_message" | "system";

export type NotifyParams = {
  kind?: NotifyKind;
  notificationId?: string;
  title?: string;
  body?: string;
  conversationId?: string;
  messageId?: string;
  approvalId?: string;
  taskId?: string;
  candidateId?: string;
  callbackNonce?: string;
  callbackSignature?: string;
  requesterName?: string;
  requestedItem?: string;
  topCandidateFileName?: string;
  localAgentCallbackPort?: number;
};

export type BridgeResult = {
  bridgeAvailable: boolean;
  supported?: boolean;
  error?: string;
};

export async function sendNotification(params: NotifyParams): Promise<BridgeResult> {
  const port = Number(process.env.NOTIFICATION_BRIDGE_PORT ?? 3400);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/notify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(3000),
    });
    const body = (await res.json().catch(() => ({}))) as { supported?: boolean; error?: string };
    if (!res.ok) return { bridgeAvailable: false, error: body.error ?? `Bridge returned ${res.status}` };
    if (body.supported === false) {
      logger.warn("notification bridge reports unsupported - using in-app notification");
      return { bridgeAvailable: false, supported: false, error: body.error };
    }
    return { bridgeAvailable: true, supported: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.warn("notification bridge unreachable - using in-app notification");
    return { bridgeAvailable: false, error };
  }
}
