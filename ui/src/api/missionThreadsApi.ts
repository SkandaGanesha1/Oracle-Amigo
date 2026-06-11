import { localAgentClient } from "./localAgentClient";
import type { MissionThreadMessage } from "./types";

export const missionThreadsApi = {
  list: (missionId: string) =>
    localAgentClient.get<{ messages: MissionThreadMessage[] }>(`/missions/${encodeURIComponent(missionId)}/thread`),
  create: (missionId: string, body: string, mentions: string[] = []) =>
    localAgentClient.post<{ message: MissionThreadMessage }>(`/missions/${encodeURIComponent(missionId)}/thread`, {
      body,
      authorType: "user",
      authorLabel: "You",
      mentions
    }),
  eventsUrl: (missionId: string) => `/missions/${encodeURIComponent(missionId)}/thread/events`
};
