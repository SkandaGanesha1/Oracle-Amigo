import type { PolicyDecision } from "../sandbox/SandboxTypes.js";

interface CommandRule {
  id: string;
  classification: string;
  reason: string;
  pattern: RegExp;
}

export interface CommandPolicyOptions {
  maxCommandLength?: number;
  maxTimeoutMs?: number;
}

export class CommandPolicy {
  readonly maxCommandLength: number;
  readonly maxTimeoutMs: number;

  private readonly rules: CommandRule[] = [
    {
      id: "destructive-filesystem",
      classification: "destructive",
      reason: "Blocked destructive filesystem command",
      pattern: /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-rf|-fr)\s+(\/|\*)/i
    },
    {
      id: "format-disk",
      classification: "destructive",
      reason: "Blocked disk formatting command",
      pattern: /\bmkfs(\.\w+)?\b/i
    },
    {
      id: "raw-disk-write",
      classification: "destructive",
      reason: "Blocked raw disk write command",
      pattern: /\bdd\s+([^;&|]*\s)?if=/i
    },
    {
      id: "host-shutdown",
      classification: "destructive",
      reason: "Blocked shutdown or reboot command",
      pattern: /\b(shutdown|reboot|poweroff|halt)\b/i
    },
    {
      id: "fork-bomb",
      classification: "resource-abuse",
      reason: "Blocked fork bomb pattern",
      pattern: /:\s*\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;?\s*:/i
    },
    {
      id: "metadata-service",
      classification: "credential-exfiltration",
      reason: "Blocked cloud metadata service access",
      pattern: /\b(curl|wget)\b[^;&|]*https?:\/\/169\.254\.169\.254/i
    },
    {
      id: "host-secret-path",
      classification: "credential-exfiltration",
      reason: "Blocked attempt to read common host secret paths",
      pattern: /\b(cat|less|more|type|Get-Content)\b[^;&|]*(\.ssh\/|\.aws\/|\.azure\/|\.gnupg\/|\.kube\/|\.docker\/config\.json|\/etc\/shadow|\.codex\/\.sandbox-secrets)/i
    },
    {
      id: "sensitive-env-print",
      classification: "credential-exfiltration",
      reason: "Blocked attempt to print sensitive environment variables",
      pattern: /\b(printenv|env|set|Get-ChildItem\s+Env:|echo|printf)\b[^;&|]*(TOKEN|SECRET|KEY|PASSWORD)/i
    }
  ];

  constructor(options: CommandPolicyOptions = {}) {
    this.maxCommandLength = options.maxCommandLength ?? Number(process.env.SANDBOX_MAX_COMMAND_LENGTH ?? 4000);
    this.maxTimeoutMs = options.maxTimeoutMs ?? Number(process.env.SANDBOX_MAX_TIMEOUT_MS ?? 120000);
  }

  evaluate(command: string): PolicyDecision {
    if (command.length > this.maxCommandLength) {
      return {
        allowed: false,
        reason: `Command exceeds maximum length of ${this.maxCommandLength} characters`,
        matchedRule: "max-command-length",
        classification: "resource-control"
      };
    }

    for (const rule of this.rules) {
      if (rule.pattern.test(command)) {
        return {
          allowed: false,
          reason: rule.reason,
          matchedRule: rule.id,
          classification: rule.classification
        };
      }
    }

    return {
      allowed: true,
      reason: "Command allowed by policy",
      classification: this.classify(command)
    };
  }

  capTimeout(timeoutMs?: number): number {
    const requested = timeoutMs ?? 30000;
    return Math.min(Math.max(requested, 1), this.maxTimeoutMs);
  }

  private classify(command: string): string {
    if (/\b(npm|pnpm|yarn|pip|uv|cargo|go)\b/i.test(command)) {
      return "package-or-build";
    }
    if (/\b(git|gh)\b/i.test(command)) {
      return "repo";
    }
    if (/\b(vitest|pytest|npm\s+test|cargo\s+test|go\s+test)\b/i.test(command)) {
      return "test";
    }
    return "general";
  }
}
