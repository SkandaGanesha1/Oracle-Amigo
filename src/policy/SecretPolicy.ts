export interface HostScopedSecret {
  name: string;
  value: string;
  allowedHosts: string[];
}

export class SecretPolicy {
  private readonly sensitiveNamePattern = /(TOKEN|SECRET|KEY|PASSWORD|AUTHORIZATION|COOKIE|CREDENTIAL|PRIVATE|SESSION|API[_-]?KEY)/i;
  private readonly tokenPatterns = [
    /Bearer\s+[A-Za-z0-9._~+/=-]+/gi,
    /Basic\s+[A-Za-z0-9._~+/=-]+/gi,
    /gh[pousr]_[A-Za-z0-9_]{20,}/gi,
    /npm_[A-Za-z0-9]{20,}/gi,
    /sk-[A-Za-z0-9_-]{20,}/gi,
    /(x-api-key:\s*)[^\r\n]+/gi,
    /(Authorization:\s*)(Basic|Bearer)\s+[A-Za-z0-9._~+/=-]+/gi,
    /(Cookie:\s*)[^\r\n]+/gi,
    /(Set-Cookie:\s*)[^\r\n]+/gi,
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    /\b(token|secret|password|api[_-]?key|authorization|cookie|session)\s*[:=]\s*[^\s,;]+/gi
  ];

  getHostScopedSecrets(env: NodeJS.ProcessEnv = process.env): Record<string, { hosts: string[]; value: string }> {
    const configured: HostScopedSecret[] = [
      { name: "GITHUB_TOKEN", value: env.GITHUB_TOKEN ?? "", allowedHosts: ["api.github.com", "github.com"] },
      { name: "NPM_TOKEN", value: env.NPM_TOKEN ?? "", allowedHosts: ["registry.npmjs.org"] }
    ].filter((secret) => secret.value.length > 0);

    return Object.fromEntries(
      configured.map((secret) => [
        secret.name,
        {
          hosts: secret.allowedHosts,
          value: secret.value
        }
      ])
    );
  }

  redactText(input: string): string {
    let output = input;

    for (const [name, value] of Object.entries(process.env)) {
      if (!value || !this.sensitiveNamePattern.test(name)) {
        continue;
      }
      output = output.split(value).join(`[REDACTED:${name}]`);
    }

    for (const pattern of this.tokenPatterns) {
      output = output.replace(pattern, (match, prefix) => {
        if (typeof prefix === "string" && prefix.trim().length > 0) {
          return `${prefix}[REDACTED]`;
        }
        return "[REDACTED]";
      });
    }

    return output;
  }

  redactObject<T>(input: T): T {
    if (typeof input === "string") {
      return this.redactText(input) as T;
    }

    if (Array.isArray(input)) {
      return input.map((item) => this.redactObject(item)) as T;
    }

    if (input && typeof input === "object") {
      return Object.fromEntries(
        Object.entries(input as Record<string, unknown>).map(([key, value]) => {
          if (this.sensitiveNamePattern.test(key)) {
            return [key, "[REDACTED]"];
          }
          return [key, this.redactObject(value)];
        })
      ) as T;
    }

    return input;
  }

  containsRedaction(input: string): boolean {
    return this.redactText(input) !== input;
  }
}
