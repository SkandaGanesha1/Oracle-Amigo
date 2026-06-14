import { platform, release } from "node:os";
import { AuthClient } from "../cloud/AuthClient.js";
import { EnrollmentClient, type EnrollRequest } from "../cloud/EnrollmentClient.js";
import { ControlPlaneClient } from "../cloud/ControlPlaneClient.js";
import { LocalCloudIdentityStore, defaultProfileId } from "../cloud/LocalCloudIdentityStore.js";
import { buildV1AgentCard } from "../protocol/a2a-v1/AgentCardV1.js";
import { generateOrLoadIdentity } from "../security/DeviceIdentity.js";
import { resolveDbPath } from "../db/connection.js";

export interface AgentRegistrationOptions {
  profileId?: string;
  agentBaseUrl?: string;
  deviceName?: string;
  agentDisplayName?: string;
  version?: string;
  capabilities?: string[];
  agentCard?: Record<string, unknown>;
}

export class AgentRegistrationService {
  constructor(private store = new LocalCloudIdentityStore()) {}

  async enroll(opts: AgentRegistrationOptions = {}) {
    const profileId = opts.profileId ?? defaultProfileId();
    const identity = this.store.getOrCreate(profileId);
    if (!identity.userAccessToken) {
      throw new Error("Login or signup is required before enrollment");
    }
    let userAccessToken = identity.userAccessToken;
    const userRefreshToken = identity.userRefreshToken ?? identity.refreshToken;
    if (userRefreshToken) {
      const bundle = await new AuthClient(new ControlPlaneClient(identity.controlPlaneUrl)).refresh(userRefreshToken);
      this.store.save(profileId, {
        controlPlaneUrl: identity.controlPlaneUrl,
        userAccessToken: bundle.access_token,
        refreshToken: bundle.refresh_token,
        userRefreshToken: bundle.refresh_token,
        status: identity.status === "disconnected" ? "authenticated" : identity.status
      });
      userAccessToken = bundle.access_token;
    }
    const localIdentity = generateOrLoadIdentity(identity.displayName ?? "Local User", resolveDbPath());
    const port = process.env.AGENTIC_AGENT_PORT ?? process.env.SANDBOX_PORT ?? "3399";
    const baseUrl = opts.agentBaseUrl ?? `http://127.0.0.1:${port}`;
    const agentCard = opts.agentCard ?? buildV1AgentCard(
      {
        name: opts.agentDisplayName ?? "Oracle Amigo Local Agent",
        description: "Local Oracle Amigo agent",
        version: opts.version ?? "0.1.0",
        organization: "Oracle Amigo",
        skills: [],
        defaultInputModes: ["text/plain", "application/json"],
        defaultOutputModes: ["text/plain", "application/json"]
      },
      { publicBaseUrl: baseUrl }
    ) as unknown as Record<string, unknown>;
    const req: EnrollRequest = {
      device: {
        device_name: opts.deviceName ?? process.env.COMPUTERNAME ?? "Local Device",
        os: platform(),
        os_version: release(),
        public_key: localIdentity.publicKey,
        did: localIdentity.did
      },
      agent: {
        display_name: opts.agentDisplayName ?? "Oracle Amigo Local Agent",
        version: opts.version ?? "0.1.0",
        capabilities: opts.capabilities ?? ["a2a.v1", "file.request", "file.transfer"],
        agent_card: agentCard
      }
    };
    const result = await new EnrollmentClient(new ControlPlaneClient(identity.controlPlaneUrl)).enroll(req, userAccessToken);
    this.store.save(profileId, {
      orgId: result.org_id,
      userId: result.user_id,
      deviceId: result.device_id,
      agentId: result.agent_id,
      agentInstanceId: result.agent_instance_id,
      relayInboxUrl: result.relay_inbox_url,
      deviceAccessToken: result.device_access_token,
      deviceRefreshToken: result.refresh_token,
      status: "enrolled"
    });
    return result;
  }
}
