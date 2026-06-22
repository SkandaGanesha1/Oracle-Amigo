import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const GENERATED_CSS_WARNING_PATTERNS = [
  /-webkit-text-size-adjust\s*:\s*100%\s*;?/g,
  /(?<!-webkit-)text-size-adjust\s*:\s*100%\s*;?/g,
  /\.text-wrap\s*\{\s*text-wrap\s*:\s*wrap\s*;?\s*\}/g
];

export function sanitizeUiCss(css: string): string {
  return GENERATED_CSS_WARNING_PATTERNS.reduce(
    (result, pattern) => result.replace(pattern, ""),
    css
  );
}

export async function sanitizeBuiltUiCss(root = process.cwd()): Promise<string[]> {
  const assetsDir = join(root, "public", "assets");
  const entries = await readdir(assetsDir, { withFileTypes: true });
  const cssFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".css"))
    .map((entry) => join(assetsDir, entry.name));

  const changed: string[] = [];
  for (const file of cssFiles) {
    const original = await readFile(file, "utf8");
    const sanitized = sanitizeUiCss(original);
    if (sanitized !== original) {
      await writeFile(file, sanitized, "utf8");
      changed.push(file);
    }
  }

  return changed;
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);

if (isMain) {
  const changed = await sanitizeBuiltUiCss();
  if (changed.length > 0) {
    console.log(`Sanitized ${changed.length} generated UI CSS asset(s).`);
  }
}
