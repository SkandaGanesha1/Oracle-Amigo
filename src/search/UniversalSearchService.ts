import type { DatabaseSync } from "node:sqlite";

export type UniversalSearchType =
  | "conversation"
  | "agent"
  | "file"
  | "mission"
  | "approval"
  | "transfer"
  | "audit"
  | "setting"
  | "policy";

export interface UniversalSearchResult {
  id: string;
  type: UniversalSearchType;
  title: string;
  subtitle: string;
  snippet: string;
  route: string;
  score: number;
  createdAt?: string;
  metadata?: Record<string, unknown>;
}

export interface UniversalSearchOptions {
  query: string;
  types?: UniversalSearchType[];
  limit?: number;
}

const ALL_TYPES: UniversalSearchType[] = [
  "conversation",
  "agent",
  "file",
  "mission",
  "approval",
  "transfer",
  "audit",
  "setting",
  "policy"
];

const STATIC_SETTINGS: UniversalSearchResult[] = [
  { id: "settings-security", type: "setting", title: "Security settings", subtitle: "Session, device, and encryption", snippet: "Review tokens, device identity, and encryption status.", route: "/settings", score: 0.4 },
  { id: "settings-policy", type: "policy", title: "Command policy simulator", subtitle: "Evaluate local commands", snippet: "Dry-run policy checks without executing commands.", route: "/settings", score: 0.4 },
  { id: "settings-notifications", type: "setting", title: "Notification settings", subtitle: "Approvals, transfers, and failures", snippet: "Configure which events trigger in-app and OS notifications.", route: "/settings", score: 0.4 },
  { id: "settings-privacy", type: "setting", title: "Privacy-safe mode", subtitle: "Mask filenames for screen sharing", snippet: "Hide sensitive filenames and local-looking paths in the UI.", route: "/settings", score: 0.4 }
];

export class UniversalSearchService {
  constructor(
    private readonly db: DatabaseSync,
    private readonly sanitize: (value: string) => string
  ) {}

  search(options: UniversalSearchOptions): { query: string; results: UniversalSearchResult[] } {
    const query = options.query.trim();
    const limit = Math.min(Math.max(options.limit ?? 20, 1), 50);
    const types = new Set(options.types?.length ? options.types : ALL_TYPES);
    const results: UniversalSearchResult[] = [];

    if (types.has("conversation")) results.push(...this.conversations(query));
    if (types.has("agent")) results.push(...this.agents(query));
    if (types.has("file")) results.push(...this.files(query));
    if (types.has("mission")) results.push(...this.missions(query));
    if (types.has("approval")) results.push(...this.approvals(query));
    if (types.has("transfer")) results.push(...this.transfers(query));
    if (types.has("audit")) results.push(...this.audit(query));
    if (types.has("setting") || types.has("policy")) results.push(...this.staticResults(query, types));

    return {
      query,
      results: results
        .map((item) => ({ ...item, title: this.safe(item.title), subtitle: this.safe(item.subtitle), snippet: this.safe(item.snippet) }))
        .sort((a, b) => b.score - a.score || String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")))
        .slice(0, limit)
    };
  }

  private conversations(query: string): UniversalSearchResult[] {
    return this.safeAll(() => {
      const rows = this.db.prepare(`
        SELECT c.id, c.title, c.updated_at, c.last_message_at, m.text
        FROM conversations c
        LEFT JOIN chat_messages m ON m.id = (
          SELECT id FROM chat_messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1
        )
        WHERE c.title LIKE ? OR COALESCE(m.text, '') LIKE ?
        ORDER BY COALESCE(c.last_message_at, c.updated_at) DESC
        LIMIT 20
      `).all(this.like(query), this.like(query)) as Array<Record<string, unknown>>;
      return rows.map((row) => ({
        id: String(row.id),
        type: "conversation" as const,
        title: String(row.title ?? "Conversation"),
        subtitle: "Conversation",
        snippet: String(row.text ?? "Open conversation"),
        route: `/chats/${encodeURIComponent(String(row.id))}`,
        score: this.score(query, [row.title, row.text], 0.8),
        createdAt: String(row.last_message_at ?? row.updated_at ?? "")
      }));
    });
  }

  private agents(query: string): UniversalSearchResult[] {
    return this.safeAll(() => {
      const rows = this.db.prepare(`
        SELECT did, name, description, trust_level, last_seen
        FROM agent_registry
        WHERE name LIKE ? OR description LIKE ? OR did LIKE ?
        ORDER BY last_seen DESC
        LIMIT 20
      `).all(this.like(query), this.like(query), this.like(query)) as Array<Record<string, unknown>>;
      return rows.map((row) => ({
        id: String(row.did),
        type: "agent" as const,
        title: String(row.name ?? "Registered agent"),
        subtitle: `Trust: ${String(row.trust_level ?? "unverified")}`,
        snippet: String(row.description ?? row.did ?? ""),
        route: "/agents",
        score: this.score(query, [row.name, row.description, row.did], 0.75),
        createdAt: String(row.last_seen ?? "")
      }));
    });
  }

  private files(query: string): UniversalSearchResult[] {
    return this.safeAll(() => {
      const rows = this.db.prepare(`
        SELECT id, file_name, display_path, extension, size_bytes, last_indexed_at
        FROM file_index
        WHERE file_name LIKE ? OR display_path LIKE ? OR indexed_text LIKE ?
        ORDER BY last_indexed_at DESC
        LIMIT 20
      `).all(this.like(query), this.like(query), this.like(query)) as Array<Record<string, unknown>>;
      return rows.map((row) => ({
        id: String(row.id),
        type: "file" as const,
        title: String(row.file_name ?? "Indexed file"),
        subtitle: `${String(row.extension ?? "file")} - ${Number(row.size_bytes ?? 0)} bytes`,
        snippet: String(row.display_path ?? "Local path hidden"),
        route: "/files",
        score: this.score(query, [row.file_name, row.display_path], 0.7),
        createdAt: String(row.last_indexed_at ?? "")
      }));
    });
  }

  private missions(query: string): UniversalSearchResult[] {
    return this.safeAll(() => {
      const rows = this.db.prepare(`
        SELECT id, type, status, metadata_json, updated_at
        FROM a2a_tasks
        WHERE id LIKE ? OR type LIKE ? OR status LIKE ? OR metadata_json LIKE ?
        ORDER BY updated_at DESC
        LIMIT 20
      `).all(this.like(query), this.like(query), this.like(query), this.like(query)) as Array<Record<string, unknown>>;
      return rows.map((row) => ({
        id: String(row.id),
        type: "mission" as const,
        title: `Mission ${String(row.id).slice(0, 8)}`,
        subtitle: `${String(row.type ?? "task")} - ${String(row.status ?? "unknown")}`,
        snippet: String(row.metadata_json ?? "{}"),
        route: "/tasks",
        score: this.score(query, [row.id, row.type, row.status, row.metadata_json], 0.65),
        createdAt: String(row.updated_at ?? "")
      }));
    });
  }

  private approvals(query: string): UniversalSearchResult[] {
    return this.safeAll(() => {
      const rows = this.db.prepare(`
        SELECT id, task_id, requester_agent_id, status, bound_file_path, created_at
        FROM approval_requests
        WHERE id LIKE ? OR task_id LIKE ? OR requester_agent_id LIKE ? OR COALESCE(bound_file_path, '') LIKE ?
        ORDER BY created_at DESC
        LIMIT 20
      `).all(this.like(query), this.like(query), this.like(query), this.like(query)) as Array<Record<string, unknown>>;
      return rows.map((row) => ({
        id: String(row.id),
        type: "approval" as const,
        title: `Approval ${String(row.id).slice(0, 8)}`,
        subtitle: String(row.status ?? "pending"),
        snippet: String(row.bound_file_path ?? row.requester_agent_id ?? "File approval"),
        route: "/approvals",
        score: this.score(query, [row.id, row.task_id, row.requester_agent_id, row.bound_file_path], 0.72),
        createdAt: String(row.created_at ?? "")
      }));
    });
  }

  private transfers(query: string): UniversalSearchResult[] {
    return this.safeAll(() => {
      const rows = this.db.prepare(`
        SELECT id, task_id, file_name, status, sha256, created_at
        FROM transfers
        WHERE id LIKE ? OR task_id LIKE ? OR file_name LIKE ? OR sha256 LIKE ?
        ORDER BY created_at DESC
        LIMIT 20
      `).all(this.like(query), this.like(query), this.like(query), this.like(query)) as Array<Record<string, unknown>>;
      return rows.map((row) => ({
        id: String(row.id),
        type: "transfer" as const,
        title: String(row.file_name ?? "Transfer"),
        subtitle: String(row.status ?? "unknown"),
        snippet: `SHA-256 ${String(row.sha256 ?? "").slice(0, 12)}`,
        route: "/files",
        score: this.score(query, [row.file_name, row.sha256, row.task_id], 0.68),
        createdAt: String(row.created_at ?? "")
      }));
    });
  }

  private audit(query: string): UniversalSearchResult[] {
    return this.safeAll(() => {
      const rows = this.db.prepare(`
        SELECT id, event_type, details_json, created_at
        FROM audit_events
        WHERE event_type LIKE ? OR details_json LIKE ?
        ORDER BY created_at DESC
        LIMIT 20
      `).all(this.like(query), this.like(query)) as Array<Record<string, unknown>>;
      return rows.map((row) => ({
        id: String(row.id),
        type: "audit" as const,
        title: String(row.event_type ?? "Audit event").replace(/_/g, " "),
        subtitle: "Audit event",
        snippet: String(row.details_json ?? "{}"),
        route: "/audit",
        score: this.score(query, [row.event_type, row.details_json], 0.55),
        createdAt: String(row.created_at ?? "")
      }));
    });
  }

  private staticResults(query: string, types: Set<UniversalSearchType>): UniversalSearchResult[] {
    return STATIC_SETTINGS
      .filter((item) => types.has(item.type))
      .filter((item) => !query || [item.title, item.subtitle, item.snippet].join(" ").toLowerCase().includes(query.toLowerCase()))
      .map((item) => ({ ...item, score: this.score(query, [item.title, item.subtitle, item.snippet], item.score) }));
  }

  private safe(value: string): string {
    return this.sanitize(value).replace(/\s+/g, " ").trim();
  }

  private like(query: string): string {
    return `%${query.replace(/[%_]/g, "")}%`;
  }

  private score(query: string, fields: unknown[], base: number): number {
    const q = query.toLowerCase();
    if (!q) return base;
    const text = fields.filter((value) => value != null).map(String).join(" ").toLowerCase();
    if (text === q) return base + 1;
    if (text.startsWith(q)) return base + 0.75;
    if (text.includes(q)) return base + 0.45;
    return base;
  }

  private safeAll(fn: () => UniversalSearchResult[]): UniversalSearchResult[] {
    try {
      return fn();
    } catch {
      return [];
    }
  }
}
