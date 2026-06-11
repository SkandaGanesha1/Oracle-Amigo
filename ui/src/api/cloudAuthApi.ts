import type { CloudStatus } from "./types";
import { localAgentClient, request } from "./localAgentClient";

export const cloudAuthApi = {
  cloudStatus: () => localAgentClient.get<CloudStatus>("/cloud/status"),
  signup: (body: { email: string; password: string; display_name: string; org_slug?: string; control_plane_url?: string }) =>
    localAgentClient.post("/cloud/signup", body),
  login: (body: { email: string; password: string; org_slug?: string; control_plane_url?: string }) =>
    localAgentClient.post("/cloud/login", body),
  logout: () => request<{ ok: boolean; remoteRevoked: boolean }>("/cloud/logout", { method: "POST" }),
  resetDeviceIdentity: () => request<{ ok: boolean; localPublicKeyFingerprint: string }>("/cloud/device-identity/reset", { method: "POST" }),
  enroll: (body: { device_name?: string; agent_display_name?: string; capabilities?: string[] }) =>
    localAgentClient.post("/cloud/enroll", body),
  me: () => localAgentClient.get<{ user: { user_id: string; email: string; display_name: string; status: string } }>("/cloud/me")
};
