import { ControlPlaneClient } from "../cloud/ControlPlaneClient.js";
import { LocalCloudIdentityStore, defaultProfileId } from "../cloud/LocalCloudIdentityStore.js";
import { RelayClient, type RelayInboxMessage } from "../cloud/RelayClient.js";
import { PersonalAgentProtocol } from "../protocol/PersonalAgentProtocol.js";
import { withRecoveredDeviceToken } from "./CloudTokenRecovery.js";
import { RemoteTaskDispatcher } from "./RemoteTaskDispatcher.js";

export class InboxPoller {
  private timer: NodeJS.Timeout | null = null;
  private lastItems: RelayInboxMessage[] = [];
  private lastError: string | null = null;
  private lastPollAt: string | null = null;
  private lastDispatchedCount = 0;
  private dispatchCounter = 0;

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
      lastError: this.lastError,
      lastPollAt: this.lastPollAt,
      lastDispatchedCount: this.lastDispatchedCount,
      dispatchCounter: this.dispatchCounter
    };
  }

  async pollOnce(): Promise<{ items: RelayInboxMessage[]; dispatched: Array<Awaited<ReturnType<RemoteTaskDispatcher["dispatch"]>>> }> {
    const inbox = await withRecoveredDeviceToken(this.store, this.profileId, async (identity) => {
      const relay = new RelayClient(new ControlPlaneClient(identity.controlPlaneUrl));
      return relay.fetchInbox({ limit: Number(process.env.RELAY_POLL_MAX_BATCH ?? 50) }, identity.deviceAccessToken!);
    });
    this.lastItems = inbox.items;
    this.lastError = null;
    this.lastPollAt = new Date().toISOString();
    const dispatched = [];
    for (const item of inbox.items) {
      const result = await this.dispatcher.dispatch(item);
      dispatched.push(result);
      if (result.status === "created" || result.status === "duplicate") {
        await withRecoveredDeviceToken(this.store, this.profileId, async (identity) => {
          const relay = new RelayClient(new ControlPlaneClient(identity.controlPlaneUrl));
          return relay.ack(item.relay_task_id, identity.deviceAccessToken!);
        });
      } else {
        this.lastError = `Dispatch failed for relay task ${item.relay_task_id}`;
      }
    }
    this.lastDispatchedCount = dispatched.length;
    this.dispatchCounter += dispatched.length;
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
