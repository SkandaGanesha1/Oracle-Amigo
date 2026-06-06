import { createLogger } from "../logging/Logger.js";

const logger = createLogger();

export type NotifyParams = {
  approvalId: string;
  taskId: string;
  candidateId: string;
  requesterName: string;
  requestedItem: string;
  topCandidateFileName: string;
  localAgentCallbackPort: number;
};

export type BridgeResult = { bridgeAvailable: boolean; supported?: boolean };

export async function sendNotification(params: NotifyParams): Promise<BridgeResult> {
  const port = Number(process.env.NOTIFICATION_BRIDGE_PORT ?? 3400);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/notify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return { bridgeAvailable: false };
    const body = (await res.json()) as { supported?: boolean };
    if (body.supported === false) {
      logger.warn("notification bridge reports unsupported — using in-app approval");
      return { bridgeAvailable: false, supported: false };
    }
    return { bridgeAvailable: true, supported: true };
  } catch {
    logger.warn("notification bridge unreachable — using in-app approval");
    return { bridgeAvailable: false };
  }
}
