import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Database as DB } from "better-sqlite3";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export function runMigrations(db: DB): void {
  const schemaPath = join(__dirname, "schema.sql");
  const schema = readFileSync(schemaPath, "utf8");
  db.exec(schema);
}

export function ensureDefaultOrganization(db: DB, slug: string, name: string): string {
  const existing = db.prepare("SELECT id FROM organizations WHERE slug = ?").get(slug) as { id: string } | undefined;
  if (existing) return existing.id;
  const id = `org_${cryptoRandomHex(12)}`;
  db.prepare("INSERT INTO organizations (id, name, slug, created_at) VALUES (?, ?, ?, ?)").run(
    id, name, slug, new Date().toISOString()
  );
  return id;
}

function cryptoRandomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(buf);
  } else {
    for (let i = 0; i < bytes; i++) buf[i] = Math.floor(Math.random() * 256);
  }
  return Buffer.from(buf).toString("hex");
}
