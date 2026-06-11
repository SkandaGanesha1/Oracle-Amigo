import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export type PolicyAction = "allow" | "require_approval" | "deny";

export interface PolicyRule {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  role: string;
  sensitivity: string;
  fileExtension: string;
  mimeType: string;
  transferDirection: string;
  maxFileSizeBytes: number | null;
  action: PolicyAction;
  reason: string;
  priority: number;
  createdAt: string;
  updatedAt: string;
}

export interface PolicyEvaluationInput {
  role?: string;
  sensitivity?: string;
  fileExtension?: string;
  mimeType?: string;
  transferDirection?: string;
  fileSizeBytes?: number;
}

export interface PolicyEvaluation {
  action: PolicyAction;
  reason: string;
  matchedRuleId: string | null;
  matchedRuleName: string | null;
}

export class AdminPolicyEngine {
  constructor(private readonly db: DatabaseSync) {}

  list(): PolicyRule[] {
    const rows = this.db.prepare("SELECT * FROM policy_rules ORDER BY priority ASC, created_at DESC").all() as Array<Record<string, unknown>>;
    return rows.map(rowToRule);
  }

  upsert(input: Omit<Partial<PolicyRule>, "createdAt" | "updatedAt"> & { name: string; action: PolicyAction }): PolicyRule {
    const now = new Date().toISOString();
    const existing = input.id
      ? this.db.prepare("SELECT * FROM policy_rules WHERE id = ?").get(input.id) as Record<string, unknown> | undefined
      : undefined;
    const rule: PolicyRule = {
      id: input.id ?? `pol_${randomUUID()}`,
      name: input.name,
      description: input.description ?? "",
      enabled: input.enabled ?? true,
      role: input.role ?? "any",
      sensitivity: input.sensitivity ?? "any",
      fileExtension: normalizeToken(input.fileExtension ?? "any"),
      mimeType: normalizeToken(input.mimeType ?? "any"),
      transferDirection: input.transferDirection ?? "any",
      maxFileSizeBytes: input.maxFileSizeBytes ?? null,
      action: input.action,
      reason: input.reason ?? defaultReason(input.action),
      priority: input.priority ?? 100,
      createdAt: existing ? String(existing.created_at) : now,
      updatedAt: now
    };

    this.db.prepare(`
      INSERT INTO policy_rules
        (id, name, description, enabled, role, sensitivity, file_extension, mime_type, transfer_direction, max_file_size_bytes, action, reason, priority, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        enabled = excluded.enabled,
        role = excluded.role,
        sensitivity = excluded.sensitivity,
        file_extension = excluded.file_extension,
        mime_type = excluded.mime_type,
        transfer_direction = excluded.transfer_direction,
        max_file_size_bytes = excluded.max_file_size_bytes,
        action = excluded.action,
        reason = excluded.reason,
        priority = excluded.priority,
        updated_at = excluded.updated_at
    `).run(
      rule.id,
      rule.name,
      rule.description,
      rule.enabled ? 1 : 0,
      rule.role,
      rule.sensitivity,
      rule.fileExtension,
      rule.mimeType,
      rule.transferDirection,
      rule.maxFileSizeBytes,
      rule.action,
      rule.reason,
      rule.priority,
      rule.createdAt,
      rule.updatedAt
    );
    return rule;
  }

  delete(id: string): boolean {
    return this.db.prepare("DELETE FROM policy_rules WHERE id = ?").run(id).changes > 0;
  }

  evaluate(input: PolicyEvaluationInput): PolicyEvaluation {
    const rules = this.list().filter((rule) => rule.enabled);
    const match = rules.find((rule) => matches(rule, input));
    if (!match) {
      return {
        action: "require_approval",
        reason: "No admin policy matched; human approval is required by default.",
        matchedRuleId: null,
        matchedRuleName: null
      };
    }
    return {
      action: match.action,
      reason: match.reason,
      matchedRuleId: match.id,
      matchedRuleName: match.name
    };
  }

  exportCsv(): string {
    const header = ["id", "name", "enabled", "role", "sensitivity", "fileExtension", "mimeType", "transferDirection", "maxFileSizeBytes", "action", "reason", "priority"];
    const rows = this.list().map((rule) => header.map((key) => csv(String((rule as unknown as Record<string, unknown>)[key] ?? ""))).join(","));
    return [header.join(","), ...rows].join("\n");
  }
}

function matches(rule: PolicyRule, input: PolicyEvaluationInput): boolean {
  if (!tokenMatches(rule.role, input.role ?? "any")) return false;
  if (!tokenMatches(rule.sensitivity, input.sensitivity ?? "unknown")) return false;
  if (!tokenMatches(rule.fileExtension, normalizeToken(input.fileExtension ?? "none"))) return false;
  if (!tokenMatches(rule.mimeType, normalizeToken(input.mimeType ?? "application/octet-stream"))) return false;
  if (!tokenMatches(rule.transferDirection, input.transferDirection ?? "outbound")) return false;
  if (rule.maxFileSizeBytes != null && (input.fileSizeBytes ?? 0) > rule.maxFileSizeBytes) return false;
  return true;
}

function tokenMatches(ruleValue: string, actual: string): boolean {
  return ruleValue === "any" || normalizeToken(ruleValue) === normalizeToken(actual);
}

function normalizeToken(value: string): string {
  return value.trim().toLowerCase().replace(/^\./, "") || "any";
}

function defaultReason(action: PolicyAction): string {
  if (action === "deny") return "Denied by admin policy.";
  if (action === "allow") return "Allowed by admin policy.";
  return "Human approval required by admin policy.";
}

function rowToRule(row: Record<string, unknown>): PolicyRule {
  return {
    id: String(row.id),
    name: String(row.name),
    description: String(row.description ?? ""),
    enabled: Number(row.enabled ?? 0) === 1,
    role: String(row.role ?? "any"),
    sensitivity: String(row.sensitivity ?? "any"),
    fileExtension: String(row.file_extension ?? "any"),
    mimeType: String(row.mime_type ?? "any"),
    transferDirection: String(row.transfer_direction ?? "any"),
    maxFileSizeBytes: row.max_file_size_bytes == null ? null : Number(row.max_file_size_bytes),
    action: String(row.action ?? "require_approval") as PolicyAction,
    reason: String(row.reason ?? ""),
    priority: Number(row.priority ?? 100),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function csv(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}
