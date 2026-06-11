import type { A2ATaskSummary, WorkflowEvent } from "./types";
import { localAgentClient } from "./localAgentClient";

export const tasksApi = {
  list: () => localAgentClient.get<{ tasks: A2ATaskSummary[] }>("/a2a/tasks"),
  get: (taskId: string) =>
    localAgentClient.get<{
      jsonrpc: "2.0";
      id: string;
      result: { task: A2ATaskSummary };
    }>(`/a2a/tasks/${encodeURIComponent(taskId)}`),
  eventsUrl: (taskId: string) => `/a2a/tasks/${encodeURIComponent(taskId)}/events`,
  parseWorkflowEvent: (event: MessageEvent<string>) => JSON.parse(event.data) as WorkflowEvent,
};
