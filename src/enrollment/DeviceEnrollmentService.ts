import { AuthClient, type LoginRequest, type SignupRequest } from "../cloud/AuthClient.js";
import { ControlPlaneClient } from "../cloud/ControlPlaneClient.js";
import { LocalCloudIdentityStore, defaultControlPlaneUrl, defaultProfileId } from "../cloud/LocalCloudIdentityStore.js";

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
      userAccessToken: bundle.access_token,
      refreshToken: bundle.refresh_token,
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
      userAccessToken: bundle.access_token,
      refreshToken: bundle.refresh_token,
      status: "authenticated"
    });
    return bundle;
  }

  async logout(profileId = defaultProfileId()): Promise<{ ok: boolean }> {
    const identity = this.store.get(profileId);
    if (!identity?.refreshToken) {
      this.store.clearTokens(profileId);
      return { ok: true };
    }
    const auth = new AuthClient(new ControlPlaneClient(identity.controlPlaneUrl));
    try {
      await auth.logout(identity.refreshToken);
    } finally {
      this.store.clearTokens(profileId);
    }
    return { ok: true };
  }
}
