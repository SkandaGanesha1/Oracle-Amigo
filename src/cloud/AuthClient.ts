import type { ControlPlaneClient } from "./ControlPlaneClient.js";

export interface SignupRequest {
  email: string;
  password: string;
  display_name: string;
  org_slug?: string;
}

export interface LoginRequest {
  email: string;
  password: string;
  org_slug?: string;
}

export interface CloudAuthBundle {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user: { org_id: string; user_id: string; email: string; display_name: string };
}

export interface CloudRefreshBundle {
  access_token: string;
  expires_in: number;
}

export class AuthClient {
  constructor(private cp: ControlPlaneClient) {}

  signup(req: SignupRequest): Promise<CloudAuthBundle> {
    return this.cp.postJson<CloudAuthBundle>("/v1/auth/signup", req);
  }

  login(req: LoginRequest): Promise<CloudAuthBundle> {
    return this.cp.postJson<CloudAuthBundle>("/v1/auth/login", req);
  }

  refresh(refreshToken: string): Promise<CloudRefreshBundle> {
    return this.cp.postJson<CloudRefreshBundle>("/v1/auth/refresh", { refresh_token: refreshToken });
  }

  logout(refreshToken: string): Promise<{ ok: boolean }> {
    return this.cp.postJson<{ ok: boolean }>("/v1/auth/logout", { refresh_token: refreshToken });
  }

  me(accessToken: string): Promise<{ user: { org_id: string; user_id: string; email: string; display_name: string; status: string } }> {
    return this.cp.getJson("/v1/auth/me", accessToken);
  }
}
