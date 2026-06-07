import { randomUUID } from "node:crypto";
import type { Database as DB } from "better-sqlite3";
import { getDb } from "../db/connection.js";
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

export function requestContact(
  orgId: OrgId,
  requesterUserId: UserId,
  targetUserId: UserId,
  opts: { db?: DB } = {}
): ContactRecord {
  const db = opts.db ?? getDb();
  if (requesterUserId === targetUserId) {
    throw new Error("Cannot request a contact with yourself");
  }
  const target = db.prepare("SELECT id FROM users WHERE org_id = ? AND id = ?").get(orgId, targetUserId);
  if (!target) throw new Error("Target user not found in this organization");
  const existing = db.prepare(`
    SELECT * FROM contacts WHERE org_id = ? AND requester_user_id = ? AND target_user_id = ?
  `).get(orgId, requesterUserId, targetUserId) as Record<string, unknown> | undefined;
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
  db.prepare(`
    INSERT INTO contacts (id, org_id, requester_user_id, target_user_id, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'pending', ?, ?)
  `).run(id, orgId, requesterUserId, targetUserId, now, now);
  appendAuditEvent({
    orgId, actorUserId: requesterUserId, eventType: "CONTACT_REQUESTED",
    details: { contact_id: id, target_user_id: targetUserId }
  }, db);
  return {
    id, org_id: orgId, requester_user_id: requesterUserId, target_user_id: targetUserId,
    status: "pending", created_at: now, updated_at: now
  };
}

export function acceptContact(
  orgId: OrgId,
  contactId: string,
  acceptingUserId: UserId,
  opts: { db?: DB } = {}
): ContactRecord {
  const db = opts.db ?? getDb();
  const row = db.prepare("SELECT * FROM contacts WHERE org_id = ? AND id = ?").get(orgId, contactId) as Record<string, unknown> | undefined;
  if (!row) throw new Error("Contact request not found");
  if (String(row.target_user_id) !== acceptingUserId) throw new Error("Only the target user may accept this contact");
  if (row.status === "accepted") return rowToContact(row);
  if (row.status === "blocked" || row.status === "declined") throw new Error(`Contact is ${row.status}`);
  const now = new Date().toISOString();
  db.prepare("UPDATE contacts SET status = 'accepted', updated_at = ? WHERE id = ?").run(now, contactId);
  appendAuditEvent({
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

export function listContacts(
  orgId: OrgId,
  userId: UserId,
  opts: { db?: DB } = {}
): ContactRecord[] {
  const db = opts.db ?? getDb();
  const rows = db.prepare(`
    SELECT * FROM contacts WHERE org_id = ? AND (requester_user_id = ? OR target_user_id = ?)
    ORDER BY updated_at DESC
  `).all(orgId, userId, userId) as Array<Record<string, unknown>>;
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
