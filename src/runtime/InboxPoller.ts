import { ControlPlaneClient } from "../cloud/ControlPlaneClient.js";
import { LocalCloudIdentityStore, defaultProfileId } from "../cloud/LocalCloudIdentityStore.js";
import { RelayClient, type RelayInboxMessage } from "../cloud/RelayClient.js";
import { PersonalAgentProtocol } from "../protocol/PersonalAgentProtocol.js";
import { RemoteTaskDispatcher } from "./RemoteTaskDispatcher.js";

export class InboxPoller {
  private timer: NodeJS.Timeout | null = null;
  private lastItems: RelayInboxMessage[] = [];
  private lastError: string | null = null;

  constructor(
    private store = new LocalCloudIdentityStore(),
    private dispatcher = new RemoteTaskDispatcher(new PersonalAgentProtocol()),
    private profileId = defaultProfileId()
  ) {}

  get running(): boolean {
    return this.timer != null;
  }

  status() {
    return {
      running: this.running,
      lastItemCount: this.lastItems.length,
      lastError: this.lastError
    };
  }

  async pollOnce(): Promise<{ items: RelayInboxMessage[]; dispatched: Array<Awaited<ReturnType<RemoteTaskDispatcher["dispatch"]>>> }> {
    const identity = this.store.get(this.profileId);
    if (!identity?.deviceAccessToken) throw new Error("Cloud enrollment is required before inbox polling");
    const relay = new RelayClient(new ControlPlaneClient(identity.controlPlaneUrl));
    const inbox = await relay.fetchInbox({ limit: Number(process.env.RELAY_POLL_MAX_BATCH ?? 50) }, identity.deviceAccessToken);
    this.lastItems = inbox.items;
    this.lastError = null;
    const dispatched = [];
    for (const item of inbox.items) {
      const result = await this.dispatcher.dispatch(item);
      dispatched.push(result);
      await relay.ack(item.relay_task_id, identity.deviceAccessToken);
    }
    return { items: inbox.items, dispatched };
  }

  start(intervalSeconds = Number(process.env.AGENTIC_RELAY_POLL_INTERVAL_SECONDS ?? 10)): void {
    if (this.timer) return;
    const intervalMs = Math.max(1, intervalSeconds) * 1000;
    this.timer = setInterval(() => {
      void this.pollOnce().catch((err) => {
        this.lastError = err instanceof Error ? err.message : String(err);
      });
    }, intervalMs);
    void this.pollOnce().catch((err) => {
      this.lastError = err instanceof Error ? err.message : String(err);
    });
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
