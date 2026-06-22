import { AuthClient } from "./AuthClient.js";
import { ControlPlaneClient } from "./ControlPlaneClient.js";
import { isJwtExpiringSoon } from "./JwtExpiry.js";
import { LocalCloudIdentityStore, defaultProfileId, type LocalCloudIdentity } from "./LocalCloudIdentityStore.js";

const refreshLocks = new Map<string, Promise<string | null>>();
const warnedLegacyRefreshProfiles = new Set<string>();

export { isJwtExpiringSoon };

export class UserTokenManager {
  constructor(private store = new LocalCloudIdentityStore()) {}

  async getFreshUserAccessToken(profileId = defaultProfileId()): Promise<string | null> {
    const identity = this.store.get(profileId);
    if (!identity) return null;
    if (identity.userAccessToken && !isJwtExpiringSoon(identity.userAccessToken)) {
      return identity.userAccessToken;
    }
    return this.refreshSingleFlight(profileId, false);
  }

  async forceRefreshUserAccessToken(profileId = defaultProfileId()): Promise<string | null> {
    return this.refreshSingleFlight(profileId, true);
  }

  private refreshSingleFlight(profileId: string, force: boolean): Promise<string | null> {
    const existing = refreshLocks.get(profileId);
    if (existing) return existing;
    const promise = this.refreshUserTokenSafely(profileId, force)
      .finally(() => {
        refreshLocks.delete(profileId);
      });
    refreshLocks.set(profileId, promise);
    return promise;
  }

  private async refreshUserTokenSafely(profileId: string, force: boolean): Promise<string | null> {
    const before = this.store.get(profileId);
    if (!before) return null;
    if (!force && before.userAccessToken && !isJwtExpiringSoon(before.userAccessToken)) {
      return before.userAccessToken;
    }

    const refreshToken = resolveUserRefreshTokenForMigration(before);
    if (!refreshToken) {
      return !force && before.userAccessToken && !isJwtExpiringSoon(before.userAccessToken) ? before.userAccessToken : null;
    }

    try {
      const bundle = await new AuthClient(new ControlPlaneClient(before.controlPlaneUrl)).refresh(refreshToken);
      const updated = this.store.save(profileId, {
        controlPlaneUrl: before.controlPlaneUrl,
        userAccessToken: bundle.access_token,
        refreshToken: bundle.refresh_token,
        userRefreshToken: bundle.refresh_token,
        status: before.status === "disconnected" ? "authenticated" : before.status
      });
      return updated.userAccessToken;
    } catch (err) {
      const after = this.store.get(profileId);
      if (hasNewerUsableUserToken(after, refreshToken)) {
        return after.userAccessToken;
      }
      throw err;
    }
  }
}

function resolveUserRefreshTokenForMigration(identity: LocalCloudIdentity): string | null {
  if (identity.userRefreshToken) return identity.userRefreshToken;
  if (!identity.refreshToken) return null;
  if (process.env.NODE_ENV !== "production" && !warnedLegacyRefreshProfiles.has(identity.profileId)) {
    warnedLegacyRefreshProfiles.add(identity.profileId);
    console.warn(
      "Using legacy cloud refreshToken for user-token refresh migration; sign in again to store userRefreshToken."
    );
  }
  return identity.refreshToken;
}

function hasNewerUsableUserToken(identity: LocalCloudIdentity | null, previousRefreshToken: string): identity is LocalCloudIdentity & {
  userAccessToken: string;
  userRefreshToken: string;
} {
  return Boolean(
    identity?.userAccessToken &&
      identity.userRefreshToken &&
      identity.userRefreshToken !== previousRefreshToken &&
      !isJwtExpiringSoon(identity.userAccessToken)
  );
}
