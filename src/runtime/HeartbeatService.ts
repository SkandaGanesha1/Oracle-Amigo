import { ControlPlaneClient } from "../cloud/ControlPlaneClient.js";
import { LocalCloudIdentityStore, defaultProfileId } from "../cloud/LocalCloudIdentityStore.js";
import { PresenceClient } from "../cloud/PresenceClient.js";

export class HeartbeatService {
  private timer: NodeJS.Timeout | null = null;
  private lastResult: unknown = null;
  private lastError: string | null = null;

  constructor(private store = new LocalCloudIdentityStore(), private profileId = defaultProfileId()) {}

  get running(): boolean {
    return this.timer != null;
  }

  status() {
    return { running: this.running, lastResult: this.lastResult, lastError: this.lastError };
  }

  async pulse(): Promise<unknown> {
    const identity = this.store.get(this.profileId);
    if (!identity?.deviceAccessToken || !identity.agentInstanceId) {
      throw new Error("Cloud enrollment is required before heartbeat");
    }
    const result = await new PresenceClient(new ControlPlaneClient(identity.controlPlaneUrl)).heartbeat({
      agent_instance_id: identity.agentInstanceId,
      device_id: identity.deviceId ?? undefined,
      agent_id: identity.agentId ?? undefined,
      version: "0.1.0",
      status: "online",
      capabilities: ["a2a.v1", "file.request", "file.transfer"],
      local_queue_depth: 0
    }, identity.deviceAccessToken);
    this.lastResult = result;
    this.lastError = null;
    return result;
  }

  start(intervalSeconds = Number(process.env.AGENTIC_HEARTBEAT_INTERVAL_SECONDS ?? 30)): void {
    if (this.timer) return;
    const intervalMs = Math.max(1, intervalSeconds) * 1000;
    this.timer = setInterval(() => {
      void this.pulse().catch((err) => {
        this.lastError = err instanceof Error ? err.message : String(err);
      });
    }, intervalMs);
    void this.pulse().catch((err) => {
      this.lastError = err instanceof Error ? err.message : String(err);
    });
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
