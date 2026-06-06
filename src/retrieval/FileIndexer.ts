import { opendir, readFile, realpath, stat } from "node:fs/promises";
import { basename, extname, join, relative, sep } from "node:path";
import { getDb, resolveLocalTenantId, resolveLocalAgentId } from "../db/connection.js";
import { embedBatch, vecToBuffer } from "./EmbeddingModel.js";

const SKIP_DIRS = new Set([".git", "node_modules", "dist", ".vite", "coverage"]);
const TEXT_EXTS = new Set([".txt", ".md", ".ts", ".tsx", ".js", ".mjs", ".json", ".csv", ".html", ".xml", ".yml", ".yaml"]);
const MAX_SNIPPET = 8192;
const BATCH_SIZE = 24;

export async function indexRoot(root: string): Promise<number> {
  const db = getDb();
  const pending: Array<{ abs: string; root: string; ext: string; fileName: string; indexedText: string }> = [];
  let count = 0;
  await walk(root, root, db, pending, () => { count++; });
  if (pending.length > 0) {
    await embedAndStoreBatch(pending, db);
  }
  return count;
}

export async function reindexAll(root: string): Promise<number> {
  const db = getDb();
  db.prepare("DELETE FROM file_index WHERE root_id = ?").run(root);
  db.prepare("DELETE FROM file_embeddings WHERE rowid IN (SELECT id FROM file_index WHERE root_id = ?)").run(root);
  return indexRoot(root);
}

async function walk(
  dir: string, root: string,
  db: ReturnType<typeof getDb>,
  pending: Array<{ abs: string; root: string; ext: string; fileName: string; indexedText: string }>,
  onFile: () => void
): Promise<void> {
  let entries;
  try { entries = await opendir(dir); } catch { return; }
  for await (const entry of entries) {
    const abs = join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) await walk(abs, root, db, pending, onFile);
      continue;
    }
    if (!entry.isFile()) continue;
    const collected = await collectFile(abs, root, db);
    if (collected) {
      pending.push(collected);
      onFile();
    }
    if (pending.length >= BATCH_SIZE) {
      const drained = pending.splice(0, pending.length);
      await embedAndStoreBatch(drained, db);
    }
  }
}

async function collectFile(abs: string, root: string, db: ReturnType<typeof getDb>): Promise<{ abs: string; root: string; ext: string; fileName: string; indexedText: string } | null> {
  let info;
  try { info = await stat(abs); } catch { return null; }

  const display = relative(root, abs);
  const existing = db.prepare("SELECT size_bytes, modified_at FROM file_index WHERE file_path = ?").get(abs) as
    { size_bytes: number; modified_at: string } | undefined;

  const mtimeStr = info.mtime.toISOString();
  if (existing && existing.size_bytes === info.size && existing.modified_at === mtimeStr) return null; // unchanged

  const ext = extname(abs).toLowerCase();
  let indexedText = "";
  if (TEXT_EXTS.has(ext)) {
    try { indexedText = (await readFile(abs, "utf8")).slice(0, MAX_SNIPPET); } catch { /* skip */ }
  }
  return { abs, root, ext, fileName: basename(abs), indexedText };
}

async function embedAndStoreBatch(
  files: Array<{ abs: string; root: string; ext: string; fileName: string; indexedText: string }>,
  db: ReturnType<typeof getDb>
): Promise<void> {
  if (files.length === 0) return;
  const texts = files.map((f) => `${f.fileName} ${f.indexedText}`);
  const vectors = await embedBatch(texts);
  const now = new Date().toISOString();

  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const display = relative(f.root, f.abs);
    let info;
    try { info = await stat(f.abs); } catch { continue; }
    const mtimeStr = info.mtime.toISOString();

    const result = db.prepare(`
      INSERT INTO file_index (root_id, file_path, display_path, file_name, extension, size_bytes, modified_at, indexed_text, last_indexed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(file_path) DO UPDATE SET
        size_bytes=excluded.size_bytes, modified_at=excluded.modified_at,
        indexed_text=excluded.indexed_text, last_indexed_at=excluded.last_indexed_at
    `).run(f.root, f.abs, display, f.fileName, f.ext, info.size, mtimeStr, f.indexedText, now);

    const rowid = BigInt(result.lastInsertRowid !== 0n ? result.lastInsertRowid : (
      (db.prepare("SELECT id FROM file_index WHERE file_path = ?").get(f.abs) as { id: number }).id
    ));

    try {
      db.prepare("INSERT INTO fts_file_index(fts_file_index, rowid, file_name, display_path, indexed_text, extension, metadata_text) VALUES('delete', ?, ?, ?, ?, ?, ?)").run(rowid, f.fileName, display, f.indexedText, f.ext, "");
    } catch { /* row didn't exist yet, ignore */ }
    db.prepare("INSERT INTO fts_file_index(rowid, file_name, display_path, indexed_text, extension, metadata_text) VALUES(?, ?, ?, ?, ?, ?)").run(rowid, f.fileName, display, f.indexedText, f.ext, "");

    const buf = vecToBuffer(vectors[i]);
    db.prepare("DELETE FROM file_embeddings WHERE rowid = ?").run(rowid);
    db.prepare(
      "INSERT INTO file_embeddings(rowid, tenant_id, agent_id, source_type, namespace, embedding) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(rowid, resolveLocalTenantId(), resolveLocalAgentId(), "file", f.root, buf);
  }
}
