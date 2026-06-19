import { randomUUID } from "node:crypto";
import { getControlPlaneStore } from "../db/connection.js";
import type { ControlPlaneStore } from "../db/ControlPlaneStore.js";
import { appendAuditEvent } from "../audit/CloudAuditService.js";
import type { Contact, ContactStatus, OrgId, UserId } from "../types/cloud.js";

export interface ContactRecord {
  id: string;
  org_id: OrgId;
  requester_user_id: UserId;
  target_user_id: UserId;
  status: ContactStatus;
  created_at: string;
  updated_at: string;
}

export async function requestContact(
  orgId: OrgId,
  requesterUserId: UserId,
  targetUserId: UserId,
  opts: { store?: ControlPlaneStore } = {}
): Promise<ContactRecord> {
  const db = opts.store ?? getControlPlaneStore();
  if (requesterUserId === targetUserId) {
    throw new Error("Cannot request a contact with yourself");
  }
  const target = await db.one("SELECT id FROM users WHERE org_id = $1 AND id = $2", [orgId, targetUserId]);
  if (!target) throw new Error("Target user not found in this organization");
  const existing = await db.one(`
    SELECT * FROM contacts WHERE org_id = $1 AND requester_user_id = $2 AND target_user_id = $3
  `, [orgId, requesterUserId, targetUserId]);
  const now = new Date().toISOString();
  if (existing) {
    if (existing.status === "blocked") {
      throw new Error("Contact is blocked");
    }
    if (existing.status === "accepted") {
      return rowToContact(existing);
    }
    // already pending - idempotent
    return rowToContact(existing);
  }
  const id = `con_${randomUUID()}`;
  await db.execute(`
    INSERT INTO contacts (id, org_id, requester_user_id, target_user_id, status, created_at, updated_at)
    VALUES ($1, $2, $3, $4, 'pending', $5, $6)
  `, [id, orgId, requesterUserId, targetUserId, now, now]);
  await appendAuditEvent({
    orgId, actorUserId: requesterUserId, eventType: "CONTACT_REQUESTED",
    details: { contact_id: id, target_user_id: targetUserId }
  }, db);
  return {
    id, org_id: orgId, requester_user_id: requesterUserId, target_user_id: targetUserId,
    status: "pending", created_at: now, updated_at: now
  };
}

export async function acceptContact(
  orgId: OrgId,
  contactId: string,
  acceptingUserId: UserId,
  opts: { store?: ControlPlaneStore } = {}
): Promise<ContactRecord> {
  const db = opts.store ?? getControlPlaneStore();
  const row = await db.one("SELECT * FROM contacts WHERE org_id = $1 AND id = $2", [orgId, contactId]);
  if (!row) throw new Error("Contact request not found");
  if (String(row.target_user_id) !== acceptingUserId) throw new Error("Only the target user may accept this contact");
  if (row.status === "accepted") return rowToContact(row);
  if (row.status === "blocked" || row.status === "declined") throw new Error(`Contact is ${row.status}`);
  const now = new Date().toISOString();
  await db.execute("UPDATE contacts SET status = 'accepted', updated_at = $1 WHERE id = $2", [now, contactId]);
  await appendAuditEvent({
    orgId, actorUserId: acceptingUserId, eventType: "CONTACT_ACCEPTED",
    details: { contact_id: contactId, requester_user_id: row.requester_user_id }
  }, db);
  return {
    id: contactId, org_id: orgId,
    requester_user_id: String(row.requester_user_id),
    target_user_id: String(row.target_user_id),
    status: "accepted", created_at: String(row.created_at), updated_at: now
  };
}

export async function listContacts(
  orgId: OrgId,
  userId: UserId,
  opts: { store?: ControlPlaneStore } = {}
): Promise<ContactRecord[]> {
  const db = opts.store ?? getControlPlaneStore();
  const rows = await db.query(`
    SELECT * FROM contacts WHERE org_id = $1 AND (requester_user_id = $2 OR target_user_id = $3)
    ORDER BY updated_at DESC
  `, [orgId, userId, userId]);
  return rows.map(rowToContact);
}

function rowToContact(row: Record<string, unknown>): ContactRecord {
  return {
    id: String(row.id),
    org_id: String(row.org_id),
    requester_user_id: String(row.requester_user_id),
    target_user_id: String(row.target_user_id),
    status: String(row.status) as ContactStatus,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at)
  };
}
