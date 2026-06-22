import { AuthClient, type LoginRequest, type SignupRequest } from "../cloud/AuthClient.js";
import { ControlPlaneClient } from "../cloud/ControlPlaneClient.js";
import { LocalCloudIdentityStore, defaultControlPlaneUrl, defaultProfileId } from "../cloud/LocalCloudIdentityStore.js";
import { UserTokenManager } from "../cloud/UserTokenManager.js";

export interface LocalAuthOptions {
  profileId?: string;
  controlPlaneUrl?: string;
}

export class DeviceEnrollmentService {
  constructor(private store = new LocalCloudIdentityStore()) {}

  async signup(req: SignupRequest, opts: LocalAuthOptions = {}) {
    const profileId = opts.profileId ?? defaultProfileId();
    const controlPlaneUrl = opts.controlPlaneUrl ?? defaultControlPlaneUrl();
    const bundle = await new AuthClient(new ControlPlaneClient(controlPlaneUrl)).signup(req);
    this.store.save(profileId, {
      controlPlaneUrl,
      orgId: bundle.user.org_id,
      userId: bundle.user.user_id,
      userEmail: bundle.user.email,
      displayName: bundle.user.display_name,
      deviceId: null,
      agentId: null,
      agentInstanceId: null,
      relayInboxUrl: null,
      userAccessToken: bundle.access_token,
      deviceAccessToken: null,
      refreshToken: bundle.refresh_token,
      userRefreshToken: bundle.refresh_token,
      deviceRefreshToken: null,
      status: "authenticated"
    });
    return bundle;
  }

  async login(req: LoginRequest, opts: LocalAuthOptions = {}) {
    const profileId = opts.profileId ?? defaultProfileId();
    const controlPlaneUrl = opts.controlPlaneUrl ?? defaultControlPlaneUrl();
    const bundle = await new AuthClient(new ControlPlaneClient(controlPlaneUrl)).login(req);
    this.store.save(profileId, {
      controlPlaneUrl,
      orgId: bundle.user.org_id,
      userId: bundle.user.user_id,
      userEmail: bundle.user.email,
      displayName: bundle.user.display_name,
      deviceId: null,
      agentId: null,
      agentInstanceId: null,
      relayInboxUrl: null,
      userAccessToken: bundle.access_token,
      deviceAccessToken: null,
      refreshToken: bundle.refresh_token,
      userRefreshToken: bundle.refresh_token,
      deviceRefreshToken: null,
      status: "authenticated"
    });
    return bundle;
  }

  async logout(profileId = defaultProfileId()): Promise<{ ok: boolean; remoteRevoked: boolean }> {
    const identity = this.store.get(profileId);
    if (!identity) {
      this.store.clearTokens(profileId);
      return { ok: true, remoteRevoked: false };
    }
    const refreshToken = identity?.userRefreshToken ?? identity?.refreshToken;
    if (!refreshToken) {
      this.store.clearTokens(profileId);
      return { ok: true, remoteRevoked: false };
    }
    const auth = new AuthClient(new ControlPlaneClient(identity.controlPlaneUrl));
    let remoteRevoked = false;
    try {
      await auth.logout(refreshToken);
      remoteRevoked = true;
    } catch {
      remoteRevoked = false;
    } finally {
      this.store.clearTokens(profileId);
    }
    return { ok: true, remoteRevoked };
  }

  async refreshUserAccessToken(profileId = defaultProfileId()): Promise<string | null> {
    return new UserTokenManager(this.store).forceRefreshUserAccessToken(profileId);
  }
}
