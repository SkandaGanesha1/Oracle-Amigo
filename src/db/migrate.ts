import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DatabaseSync } from "node:sqlite";

const SCHEMA_VERSION = 1;
const schemaPath = join(dirname(fileURLToPath(import.meta.url)), "schema.sql");

export function migrate(db: DatabaseSync): void {
  const row = db.prepare("PRAGMA user_version").get() as { user_version: number };
  if (row.user_version >= SCHEMA_VERSION) return;
  const schema = readFileSync(schemaPath, "utf8");
  db.exec(schema);
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
}
