import type { ControlPlaneStore } from "../db/ControlPlaneStore.js";
import type { AgentInstanceId, OrgId } from "../types/cloud.js";

export interface RelayRetryPolicy {
  maxAttempts: number;
  retryBaseMs: number;
  retryMaxMs: number;
  taskTtlSeconds: number;
}

export interface RelayQueueItem {
  relay_task_id: string;
  relay_message_id: string;
  from_agent_instance_id: AgentInstanceId;
  to_agent_instance_id: AgentInstanceId;
  a2a_task_id: string;
  type: string;
  payload_json: string;
  created_at: string;
  delivered_at: string | null;
  attempt_count: number;
  max_attempts: number;
}

export interface RelayQueueFetchInput {
  orgId: OrgId;
  toAgentInstanceId: AgentInstanceId;
  maxBatch: number;
  markDelivered: boolean;
  retry: RelayRetryPolicy;
}

export interface RelayQueue {
  readonly kind: "db-polling" | "redis";
  enqueue(input: {
    orgId: OrgId;
    relayTaskId: string;
    relayMessageId: string;
    queuedAt: string;
  }): Promise<void>;
  fetchInbox(input: RelayQueueFetchInput): Promise<RelayQueueItem[]>;
  markExpired(nowIso?: string): Promise<number>;
  healthCheck(): Promise<boolean>;
}

export class DbPollingRelayQueue implements RelayQueue {
  readonly kind = "db-polling" as const;

  constructor(private store: ControlPlaneStore) {}

  async enqueue(input: { orgId: OrgId; relayTaskId: string; relayMessageId: string; queuedAt: string }): Promise<void> {
    await this.store.execute(`
      UPDATE relay_tasks
      SET status = 'queued',
          queued_at = COALESCE(queued_at, $1),
          updated_at = $2
      WHERE org_id = $3
        AND id = $4
        AND status = 'accepted'
    `, [input.queuedAt, input.queuedAt, input.orgId, input.relayTaskId]);
    await this.store.execute(`
      UPDATE relay_messages
      SET status = 'queued'
      WHERE org_id = $1
        AND id = $2
        AND relay_task_id = $3
        AND status = 'queued'
    `, [input.orgId, input.relayMessageId, input.relayTaskId]);
  }

  async fetchInbox(input: RelayQueueFetchInput): Promise<RelayQueueItem[]> {
    const limit = Math.min(Math.max(input.maxBatch, 1), 500);
    const now = new Date().toISOString();
    return this.store.transaction(async (tx) => {
      await markExpiredForReceiver(tx, input.orgId, input.toAgentInstanceId, now);
      await markExhaustedAttempts(tx, input.orgId, input.toAgentInstanceId, now);

      const rows = await tx.query<RelayQueueItem>(`
        SELECT
          m.id AS relay_message_id,
          m.relay_task_id,
          m.from_agent_instance_id,
          m.to_agent_instance_id,
          m.payload_json,
          m.created_at,
          m.delivered_at,
          t.a2a_task_id,
          t.type,
          t.attempt_count,
          t.max_attempts
        FROM relay_messages m
        JOIN relay_tasks t ON t.id = m.relay_task_id
        WHERE m.org_id = $1
          AND m.to_agent_instance_id = $2
          AND m.status IN ('queued', 'delivered')
          AND t.status IN ('queued', 'delivered_to_remote_agent')
          AND (t.expires_at IS NULL OR t.expires_at > $3::timestamptz)
          AND (m.expires_at IS NULL OR m.expires_at > $3::timestamptz)
          AND (t.next_retry_at IS NULL OR t.next_retry_at <= $3::timestamptz)
          AND t.attempt_count < t.max_attempts
        ORDER BY m.created_at ASC
        LIMIT $4
        FOR UPDATE OF m, t SKIP LOCKED
      `, [input.orgId, input.toAgentInstanceId, now, limit]);

      if (!input.markDelivered || rows.length === 0) return rows;

      const messageIds = rows.map((row) => row.relay_message_id);
      const taskIds = Array.from(new Set(rows.map((row) => row.relay_task_id)));
      await tx.execute(`
        UPDATE relay_messages
        SET status = 'delivered',
            delivered_at = $1
        WHERE org_id = $2
          AND id = ANY($3::text[])
      `, [now, input.orgId, messageIds]);
      await tx.execute(`
        UPDATE relay_tasks
        SET status = 'delivered_to_remote_agent',
            delivered_at = COALESCE(delivered_at, $1),
            updated_at = $2,
            attempt_count = attempt_count + 1,
            next_retry_at = $1::timestamptz + (
              LEAST($3::double precision, $4::double precision * POWER(2, GREATEST(attempt_count, 0))) * INTERVAL '1 millisecond'
            )
        WHERE org_id = $5
          AND id = ANY($6::text[])
          AND status IN ('queued', 'delivered_to_remote_agent')
      `, [now, now, input.retry.retryMaxMs, input.retry.retryBaseMs, input.orgId, taskIds]);

      return rows.map((row) => ({
        ...row,
        delivered_at: now,
        attempt_count: Number(row.attempt_count) + 1
      }));
    });
  }

  async markExpired(nowIso = new Date().toISOString()): Promise<number> {
    const result = await this.store.execute(`
      UPDATE relay_tasks
      SET status = 'expired',
          expired_at = COALESCE(expired_at, $1),
          updated_at = $2,
          last_error = COALESCE(last_error, 'relay task expired before receiver ack')
      WHERE status IN ('accepted', 'queued', 'delivered_to_remote_agent')
        AND expires_at IS NOT NULL
        AND expires_at <= $1::timestamptz
    `, [nowIso, nowIso]);
    await this.store.execute(`
      UPDATE relay_messages
      SET status = 'expired',
          failed_at = COALESCE(failed_at, $1)
      WHERE relay_task_id IN (
        SELECT id FROM relay_tasks WHERE status = 'expired' AND expired_at = $1::timestamptz
      )
        AND status IN ('queued', 'delivered')
    `, [nowIso]);
    return result.changes;
  }

  async healthCheck(): Promise<boolean> {
    return this.store.healthCheck();
  }
}

export class RedisRelayQueue implements RelayQueue {
  readonly kind = "redis" as const;

  enqueue(): Promise<void> {
    return Promise.reject(new Error("Redis relay queue is a placeholder; use DbPollingRelayQueue for current runtime"));
  }

  fetchInbox(): Promise<RelayQueueItem[]> {
    return Promise.reject(new Error("Redis relay queue is a placeholder; use DbPollingRelayQueue for current runtime"));
  }

  markExpired(): Promise<number> {
    return Promise.resolve(0);
  }

  healthCheck(): Promise<boolean> {
    return Promise.resolve(false);
  }
}

async function markExpiredForReceiver(
  store: ControlPlaneStore,
  orgId: OrgId,
  toAgentInstanceId: AgentInstanceId,
  now: string
): Promise<void> {
  await store.execute(`
    UPDATE relay_tasks
    SET status = 'expired',
        expired_at = COALESCE(expired_at, $1),
        updated_at = $2,
        last_error = COALESCE(last_error, 'relay task expired before delivery')
    WHERE org_id = $3
      AND to_agent_instance_id = $4
      AND status IN ('accepted', 'queued', 'delivered_to_remote_agent')
      AND expires_at IS NOT NULL
      AND expires_at <= $1::timestamptz
  `, [now, now, orgId, toAgentInstanceId]);
  await store.execute(`
    UPDATE relay_messages
    SET status = 'expired',
        failed_at = COALESCE(failed_at, $1)
    WHERE org_id = $2
      AND to_agent_instance_id = $3
      AND status IN ('queued', 'delivered')
      AND relay_task_id IN (
        SELECT id FROM relay_tasks
        WHERE org_id = $2
          AND to_agent_instance_id = $3
          AND status = 'expired'
      )
  `, [now, orgId, toAgentInstanceId]);
}

async function markExhaustedAttempts(
  store: ControlPlaneStore,
  orgId: OrgId,
  toAgentInstanceId: AgentInstanceId,
  now: string
): Promise<void> {
  await store.execute(`
    UPDATE relay_tasks
    SET status = 'failed',
        failed_at = COALESCE(failed_at, $1),
        updated_at = $2,
        last_error = COALESCE(last_error, 'max relay delivery attempts exhausted')
    WHERE org_id = $3
      AND to_agent_instance_id = $4
      AND status IN ('queued', 'delivered_to_remote_agent')
      AND attempt_count >= max_attempts
  `, [now, now, orgId, toAgentInstanceId]);
  await store.execute(`
    UPDATE relay_messages
    SET status = 'failed',
        failed_at = COALESCE(failed_at, $1)
    WHERE org_id = $2
      AND to_agent_instance_id = $3
      AND status IN ('queued', 'delivered')
      AND relay_task_id IN (
        SELECT id FROM relay_tasks
        WHERE org_id = $2
          AND to_agent_instance_id = $3
          AND status = 'failed'
          AND failed_at = $1::timestamptz
      )
  `, [now, orgId, toAgentInstanceId]);
}
