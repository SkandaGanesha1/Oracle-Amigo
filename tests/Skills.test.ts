import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discoverSkills, writeSkill, loadSkillFromDir, deleteSkill } from "../src/skills/SkillRegistry.js";
import { parseSkillMarkdown } from "../src/skills/SkillParser.js";
import { getDefaultRegistry, SkillRegistry } from "../src/skills/SkillStore.js";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "skills-test-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("parseSkillMarkdown", () => {
  it("extracts frontmatter and body", () => {
    const md = `---
id: my-skill
name: My Skill
description: Does cool things
tags: [cool, useful]
---

# Body

Some content.`;
    const parsed = parseSkillMarkdown(md);
    expect(parsed.frontmatter.id).toBe("my-skill");
    expect(parsed.frontmatter.name).toBe("My Skill");
    expect(parsed.frontmatter.tags).toEqual(["cool", "useful"]);
    expect(parsed.body).toContain("Some content.");
  });

  it("handles documents with no frontmatter", () => {
    const parsed = parseSkillMarkdown("# Just a heading\n\nSome text.");
    expect(parsed.frontmatter).toEqual({});
    expect(parsed.body).toContain("Some text.");
  });

  it("parses string, list, boolean, number values", () => {
    const md = `---
id: multi
name: Multi
description: desc
version: 1.2
enabled: true
disabled: false
tags: [a, b, c]
inputModes: [text/plain]
---`;
    const parsed = parseSkillMarkdown(md);
    expect(parsed.frontmatter.version).toBe(1.2);
    expect(parsed.frontmatter.enabled).toBe(true);
    expect(parsed.frontmatter.disabled).toBe(false);
    expect(parsed.frontmatter.tags).toEqual(["a", "b", "c"]);
  });
});

describe("writeSkill / loadSkillFromDir / discoverSkills", () => {
  it("writes a SKILL.md and reads it back", async () => {
    const skillDir = join(tempDir, "test-skill");
    await writeSkill(skillDir, {
      id: "test-skill",
      name: "Test Skill",
      description: "A test skill",
      version: "0.1.0",
      tags: ["test"],
      examples: ["example 1"],
      inputModes: ["text/plain"],
      outputModes: ["application/json"],
      body: "## Description\n\nThis is a test.",
    });
    const loaded = await loadSkillFromDir(skillDir);
    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe("test-skill");
    expect(loaded!.name).toBe("Test Skill");
    expect(loaded!.body).toContain("This is a test.");
  });

  it("discovers skills from a directory", async () => {
    await writeSkill(join(tempDir, "skill-a"), { id: "skill-a", name: "A", description: "alpha", body: "a body" });
    await writeSkill(join(tempDir, "skill-b"), { id: "skill-b", name: "B", description: "beta", body: "b body" });
    const skills = await discoverSkills([tempDir], { onlyExtra: true });
    expect(skills).toHaveLength(2);
    expect(skills.map((s) => s.id).sort()).toEqual(["skill-a", "skill-b"]);
  });

  it("skips directories without SKILL.md", async () => {
    writeFileSync(join(tempDir, "not-a-skill.txt"), "x");
    const skills = await discoverSkills([tempDir], { onlyExtra: true });
    expect(skills).toHaveLength(0);
  });

  it("deletes a skill directory", async () => {
    const skillDir = join(tempDir, "to-delete");
    await writeSkill(skillDir, { id: "to-delete", name: "Del", description: "d", body: "" });
    await deleteSkill(skillDir);
    const skills = await discoverSkills([tempDir], { onlyExtra: true });
    expect(skills).toHaveLength(0);
  });
});

describe("SkillRegistry / SkillStore", () => {
  it("refresh populates the cache", async () => {
    await writeSkill(join(tempDir, "s1"), { id: "s1", name: "S1", description: "d1", body: "" });
    const reg = new SkillRegistry();
    const skills = await reg.refresh([tempDir], { onlyExtra: true });
    expect(skills).toHaveLength(1);
    expect(reg.get("s1")).toBeDefined();
    expect(reg.list()).toHaveLength(1);
  });

  it("ensureFresh caches results within interval", async () => {
    await writeSkill(join(tempDir, "s1"), { id: "s1", name: "S1", description: "d1", body: "" });
    const reg = new SkillRegistry(60_000);
    const first = await reg.ensureFresh([tempDir], { onlyExtra: true });
    const second = await reg.ensureFresh([tempDir], { onlyExtra: true });
    expect(first).toStrictEqual(second);
  });

  it("upsert and remove modify cache", async () => {
    const reg = new SkillRegistry();
    await reg.refresh([tempDir]);
    reg.upsert({
      id: "manual", name: "Manual", description: "m", version: "0.1.0", tags: [], examples: [],
      inputModes: [], outputModes: [], path: tempDir, body: "", raw: {},
    });
    expect(reg.get("manual")).toBeDefined();
    expect(reg.remove("manual")).toBe(true);
    expect(reg.get("manual")).toBeUndefined();
  });

  it("getDefaultRegistry returns a singleton", () => {
    expect(getDefaultRegistry()).toBe(getDefaultRegistry());
  });
});
