export interface ParsedSkillDoc {
  frontmatter: Record<string, string | string[] | boolean | number>;
  body: string;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export function parseSkillMarkdown(content: string): ParsedSkillDoc {
  const match = content.match(FRONTMATTER_RE);
  if (!match) return { frontmatter: {}, body: content };
  const frontmatter = parseFrontmatter(match[1]);
  const body = match[2].trim();
  return { frontmatter, body };
}

function parseFrontmatter(block: string): ParsedSkillDoc["frontmatter"] {
  const result: Record<string, string | string[] | boolean | number> = {};
  const lines = block.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith("#")) { i++; continue; }
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) { i++; continue; }
    const key = line.slice(0, colonIdx).trim();
    let value: string = line.slice(colonIdx + 1).trim();
    if (value === "" || value === "|" || value === ">") {
      const collected: string[] = [];
      i++;
      while (i < lines.length && (lines[i].startsWith("  ") || lines[i].startsWith("\t"))) {
        collected.push(lines[i].replace(/^ {2}|^ {4}/, ""));
        i++;
      }
      result[key] = collected.join("\n").trim();
      continue;
    }
    if (value.startsWith("[") && value.endsWith("]")) {
      result[key] = parseList(value.slice(1, -1));
      i++;
      continue;
    }
    if (value === "true") { result[key] = true; i++; continue; }
    if (value === "false") { result[key] = false; i++; continue; }
    if (/^-?\d+(\.\d+)?$/.test(value)) { result[key] = Number(value); i++; continue; }
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      result[key] = value.slice(1, -1);
      i++;
      continue;
    }
    result[key] = value;
    i++;
  }
  return result;
}

function parseList(inner: string): string[] {
  return inner.split(",").map((s) => s.trim().replace(/^['"]|['"]$/g, "")).filter(Boolean);
}
