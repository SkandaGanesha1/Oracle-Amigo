import { readFile, readdir, stat, writeFile, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve, dirname, basename } from "node:path";
import { homedir } from "node:os";
import { parseSkillMarkdown } from "./SkillParser.js";

export interface AgentSkillManifest {
  id: string;
  name: string;
  description: string;
  version: string;
  tags: string[];
  examples: string[];
  inputModes: string[];
  outputModes: string[];
  path: string;
  body: string;
  raw: Record<string, unknown>;
}

const SKILL_FILENAME = "SKILL.md";

export function defaultSkillsRoots(): string[] {
  const roots: string[] = [];
  if (process.env.AGENTIC_SKILLS_PATH) roots.push(process.env.AGENTIC_SKILLS_PATH);
  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData) roots.push(join(localAppData, "AgenticApp", "skills"));
  roots.push(join(homedir(), ".agentic-app", "skills"));
  roots.push(resolve(process.cwd(), ".agents", "skills"));
  return roots;
}

export async function discoverSkills(extraRoots: string[] = [], options: { onlyExtra?: boolean } = {}): Promise<AgentSkillManifest[]> {
  const roots = options.onlyExtra ? extraRoots : [...defaultSkillsRoots(), ...extraRoots];
  const seen = new Set<string>();
  const skills: AgentSkillManifest[] = [];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    const statInfo = await stat(root).catch(() => null);
    if (!statInfo?.isDirectory()) continue;
    const entries = await readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillDir = join(root, entry.name);
      const skillFile = join(skillDir, SKILL_FILENAME);
      if (!existsSync(skillFile)) continue;
      if (seen.has(skillDir)) continue;
      seen.add(skillDir);
      const manifest = await loadSkillFromDir(skillDir);
      if (manifest) skills.push(manifest);
    }
  }
  return skills;
}

export async function loadSkillFromDir(skillDir: string): Promise<AgentSkillManifest | null> {
  const skillFile = join(skillDir, SKILL_FILENAME);
  const raw = await readFile(skillFile, "utf8");
  const parsed = parseSkillMarkdown(raw);
  const id = pickString(parsed.frontmatter, "id") ?? basename(skillDir);
  const name = pickString(parsed.frontmatter, "name") ?? id;
  const description = pickString(parsed.frontmatter, "description") ?? "";
  if (!description) return null;
  return {
    id,
    name,
    description,
    version: pickString(parsed.frontmatter, "version") ?? "0.1.0",
    tags: pickStringList(parsed.frontmatter, "tags"),
    examples: pickStringList(parsed.frontmatter, "examples"),
    inputModes: pickStringList(parsed.frontmatter, "inputModes"),
    outputModes: pickStringList(parsed.frontmatter, "outputModes"),
    path: skillDir,
    body: parsed.body,
    raw: parsed.frontmatter,
  };
}

export async function writeSkill(skillDir: string, manifest: Partial<AgentSkillManifest> & { body: string }): Promise<void> {
  await mkdir(skillDir, { recursive: true });
  const fm: string[] = ["---"];
  if (manifest.id) fm.push(`id: ${manifest.id}`);
  if (manifest.name) fm.push(`name: ${manifest.name}`);
  if (manifest.description) fm.push(`description: ${manifest.description}`);
  if (manifest.version) fm.push(`version: ${manifest.version}`);
  if (manifest.tags?.length) fm.push(`tags: [${manifest.tags.map((t) => `"${t.replace(/"/g, '\\"')}"`).join(", ")}]`);
  if (manifest.examples?.length) fm.push(`examples: [${manifest.examples.map((t) => `"${t.replace(/"/g, '\\"')}"`).join(", ")}]`);
  if (manifest.inputModes?.length) fm.push(`inputModes: [${manifest.inputModes.map((t) => `"${t.replace(/"/g, '\\"')}"`).join(", ")}]`);
  if (manifest.outputModes?.length) fm.push(`outputModes: [${manifest.outputModes.map((t) => `"${t.replace(/"/g, '\\"')}"`).join(", ")}]`);
  fm.push("---", "", manifest.body);
  await writeFile(join(skillDir, SKILL_FILENAME), fm.join("\n"), "utf8");
}

export async function deleteSkill(skillDir: string): Promise<void> {
  await rm(skillDir, { recursive: true, force: true });
}

function pickString(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[key];
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return undefined;
}

function pickStringList(obj: Record<string, unknown>, key: string): string[] {
  const v = obj[key];
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  if (typeof v === "string") {
    return v.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return [];
}
