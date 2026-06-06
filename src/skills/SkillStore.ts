import type { AgentSkillManifest } from "./SkillRegistry.js";
import { discoverSkills } from "./SkillRegistry.js";

export class SkillRegistry {
  private cache: Map<string, AgentSkillManifest> = new Map();
  private lastRefresh: number = 0;
  private refreshIntervalMs: number;

  constructor(refreshIntervalMs = 5000) {
    this.refreshIntervalMs = refreshIntervalMs;
  }

  async refresh(extraRoots: string[] = [], options: { onlyExtra?: boolean } = {}): Promise<AgentSkillManifest[]> {
    const skills = await discoverSkills(extraRoots, options);
    this.cache.clear();
    for (const skill of skills) this.cache.set(skill.id, skill);
    this.lastRefresh = Date.now();
    return skills;
  }

  async ensureFresh(extraRoots: string[] = [], options: { onlyExtra?: boolean } = {}): Promise<AgentSkillManifest[]> {
    if (Date.now() - this.lastRefresh > this.refreshIntervalMs || this.cache.size === 0) {
      return this.refresh(extraRoots, options);
    }
    return Array.from(this.cache.values());
  }

  list(): AgentSkillManifest[] {
    return Array.from(this.cache.values());
  }

  get(id: string): AgentSkillManifest | undefined {
    return this.cache.get(id);
  }

  upsert(skill: AgentSkillManifest): void {
    this.cache.set(skill.id, skill);
  }

  remove(id: string): boolean {
    return this.cache.delete(id);
  }
}

let _defaultRegistry: SkillRegistry | null = null;
export function getDefaultRegistry(): SkillRegistry {
  if (!_defaultRegistry) _defaultRegistry = new SkillRegistry();
  return _defaultRegistry;
}
