import type { AgentInstance, Contact, DirectoryUser } from "./types";
import { localAgentClient } from "./localAgentClient";

export const cloudDirectoryApi = {
  directoryUsers: (q: string) =>
    localAgentClient.get<{ users: DirectoryUser[] }>(`/cloud/directory/users?q=${encodeURIComponent(q)}`),
  userAgents: (userId: string) =>
    localAgentClient.get<{ user_id: string; agents: AgentInstance[] }>(`/cloud/directory/users/${encodeURIComponent(userId)}/agents`),
  contacts: () => localAgentClient.get<{ contacts: Contact[] }>("/cloud/contacts"),
  requestContact: (target_user_id: string) =>
    localAgentClient.post<Contact>("/cloud/contacts/request", { target_user_id }),
  acceptContact: (contactId: string) =>
    localAgentClient.post<Contact>(`/cloud/contacts/${encodeURIComponent(contactId)}/accept`, {})
};
