import type { SkillManifest } from "./types";
import { localAgentClient } from "./localAgentClient";

export const skillsApi = {
  list: () => localAgentClient.get<{ count: number; skills: SkillManifest[] }>("/skills"),
};
