import type { NetworkProfile } from "../sandbox/SandboxTypes.js";

export interface NetworkPolicyResult {
  profile: NetworkProfile;
  allowedHosts: string[];
}

const PROFILE_HOSTS: Record<Exclude<NetworkProfile, "custom">, string[]> = {
  none: [],
  npm: ["registry.npmjs.org"],
  python: ["pypi.org", "files.pythonhosted.org"],
  github: ["github.com", "api.github.com", "raw.githubusercontent.com"],
  "web-basic": ["example.com"]
};

export class NetworkPolicy {
  resolve(profile: NetworkProfile, customHosts: string[] = []): NetworkPolicyResult {
    if (profile === "custom") {
      return { profile, allowedHosts: this.normalizeHosts(customHosts) };
    }

    return { profile, allowedHosts: [...PROFILE_HOSTS[profile]] };
  }

  isHostAllowed(host: string, allowedHosts: string[]): boolean {
    const normalized = this.normalizeHost(host);
    return allowedHosts.includes(normalized);
  }

  private normalizeHosts(hosts: string[]): string[] {
    return [...new Set(hosts.map((host) => this.normalizeHost(host)).filter(Boolean))];
  }

  private normalizeHost(host: string): string {
    return host.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  }
}
