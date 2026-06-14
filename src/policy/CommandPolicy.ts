import type { PolicyDecision } from "../sandbox/SandboxTypes.js";
import { validateCommandStructure } from "../security/CommandStructureValidator.js";
import { parseSecureCommandContext, type SecureCommandContext } from "../security/SecureCommandContext.js";

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

export interface NormalizedPolicyDecision extends PolicyDecision {
  normalizedCommand?: string;
  riskScore?: number;
  mitigations?: string[];
}

export class CommandPolicy {
  readonly maxCommandLength: number;
  readonly maxTimeoutMs: number;

  private readonly rules: CommandRule[] = [
    {
      id: "destructive-filesystem",
      classification: "destructive",
      reason: "Blocked destructive filesystem command",
      pattern: /\b(Remove-Item|rm|del|erase)\b[^;&|]*(?:-[a-zA-Z]*r[a-zA-Z]*|-Recurse)\b[^;&|]*(?:-[a-zA-Z]*f[a-zA-Z]*|-Force)\b/i
    },
    {
      id: "destructive-root-or-wildcard",
      classification: "destructive",
      reason: "Blocked destructive filesystem command targeting a root or wildcard path",
      pattern: /\b(Remove-Item|rm|del|erase)\b[^;&|]*(?:\/|\*|[a-z]:\\)(?:\s|$)/i
    },
    {
      id: "format-disk",
      classification: "destructive",
      reason: "Blocked disk formatting command",
      pattern: /\b(mkfs(\.\w+)?|Format-Volume|format\.com|diskpart)\b/i
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
      pattern: /\b(curl|wget|Invoke-WebRequest|Invoke-RestMethod|iwr|irm|certutil|bitsadmin|node|python|python3)\b[^;&|]*(?:169\.254\.169\.254|metadata\.google\.internal)/i
    },
    {
      id: "encoded-powershell",
      classification: "credential-exfiltration",
      reason: "Blocked encoded PowerShell command",
      pattern: /\bpowershell(?:\.exe)?\b[^;&|]*(?:-EncodedCommand|-enc)\b/i
    },
    {
      id: "download-or-process-control",
      classification: "credential-exfiltration",
      reason: "Blocked download or process-control command",
      pattern: /\b(Invoke-WebRequest|Invoke-RestMethod|iwr|irm|certutil|bitsadmin|Start-Process|reg(?:\.exe)?)\b/i
    },
    {
      id: "host-secret-path",
      classification: "credential-exfiltration",
      reason: "Blocked attempt to read common host secret paths",
      pattern: /\b(cat|less|more|type|Get-Content|gc)\b[^;&|]*(\.ssh[\\/]|\.aws[\\/]|\.azure[\\/]|\.gnupg[\\/]|\.kube[\\/]|\.docker[\\/]config\.json|\/etc\/shadow|\.codex[\\/]\.sandbox-secrets)/i
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

  evaluate(command: string, context?: Partial<SecureCommandContext>): NormalizedPolicyDecision {
    const secureContext = parseSecureCommandContext(context);
    if (command.length > this.maxCommandLength) {
      return {
        allowed: false,
        reason: `Command exceeds maximum length of ${this.maxCommandLength} characters`,
        matchedRule: "max-command-length",
        classification: "resource-control",
        riskScore: 80,
        mitigations: ["Shorten the command or move complex logic into reviewed source files."]
      };
    }

    const dynamic = detectDynamicShell(command);
    if (dynamic) {
      return {
        allowed: false,
        reason: dynamic.reason,
        matchedRule: dynamic.rule,
        classification: "credential-exfiltration",
        riskScore: 90,
        mitigations: ["Use a direct allowlisted command entrypoint with explicit arguments."]
      };
    }

    const normalizedCommand = normalizeCommand(command);
    const structure = validateCommandStructure(normalizedCommand, secureContext);
    if (!structure.allowed) {
      return {
        allowed: false,
        reason: structure.reason,
        matchedRule: structure.matchedRule,
        classification: structure.classification,
        normalizedCommand,
        riskScore: structure.riskScore,
        mitigations: structure.mitigations
      };
    }

    for (const rule of this.rules) {
      if (rule.pattern.test(normalizedCommand)) {
        return {
          allowed: false,
          reason: rule.reason,
          matchedRule: rule.id,
          classification: rule.classification,
          normalizedCommand,
          riskScore: 85,
          mitigations: ["Use a narrower allowlisted command or perform the operation through the approved API."]
        };
      }
    }

    const privateNetwork = !secureContext.allowPrivateNetwork && targetsPrivateNetwork(normalizedCommand);
    if (privateNetwork) {
      return {
        allowed: false,
        reason: "Blocked private or metadata network target",
        matchedRule: "private-network-target",
        classification: "credential-exfiltration",
        normalizedCommand,
        riskScore: 95,
        mitigations: ["Route network access through a configured network profile and explicit host allowlist."]
      };
    }

    const commandNames = extractCommandNames(normalizedCommand);
    const deniedCommand = commandNames.find((name) => !ALLOWED_COMMANDS.has(name.toLowerCase()));
    if (deniedCommand) {
      return {
        allowed: false,
        reason: `Command '${deniedCommand}' is not allowlisted`,
        matchedRule: "not-allowlisted",
        classification: "review-required",
        normalizedCommand,
        riskScore: 70,
        mitigations: ["Add a reviewed policy rule for this command before using it."]
      };
    }

    return {
      allowed: true,
      reason: "Command allowed by policy",
      classification: this.classify(normalizedCommand),
      normalizedCommand,
      riskScore: 0,
      mitigations: []
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

const ALLOWED_COMMANDS = new Set([
  "base64",
  "cat",
  "cargo",
  "deno",
  "dotnet",
  "echo",
  "git",
  "gh",
  "go",
  "grep",
  "head",
  "ls",
  "mkdir",
  "node",
  "npm",
  "npx",
  "pnpm",
  "printf",
  "python",
  "python3",
  "pytest",
  "rg",
  "sed",
  "tail",
  "tsx",
  "tsc",
  "uv",
  "vitest",
  "yarn",
  "get-childitem",
  "get-content",
  "where.exe"
]);

export function normalizeCommand(command: string): string {
  return command
    .replace(/`[\r\n]?/g, "")
    .replace(/#.*$/gm, "")
    .replace(/\b(gci|ls|dir)\b/gi, "Get-ChildItem")
    .replace(/\b(gc)\b/gi, "Get-Content")
    .replace(/\b(iwr)\b/gi, "Invoke-WebRequest")
    .replace(/\b(irm)\b/gi, "Invoke-RestMethod")
    .replace(/\b(del|erase)\b/gi, "Remove-Item")
    .trim();
}

function detectDynamicShell(command: string): { rule: string; reason: string } | null {
  if (/\$\(|<\(|>\(/.test(command)) {
    return { rule: "dynamic-command-substitution", reason: "Command substitution requires review" };
  }
  if (/[`]/.test(command)) {
    return { rule: "dynamic-backtick", reason: "Backtick shell syntax requires review" };
  }
  if (/(?:^|[\s;&|])&\s*\$[A-Za-z_]/.test(command)) {
    return { rule: "dynamic-powershell-invocation", reason: "Dynamic PowerShell invocation requires review" };
  }
  if (/\b(Invoke-Expression|iex)\b/i.test(command)) {
    return { rule: "dynamic-powershell-expression", reason: "PowerShell expression evaluation is blocked" };
  }
  if (/['"]\s*\+\s*['"]/.test(command)) {
    return { rule: "dynamic-string-concatenation", reason: "Shell string concatenation requires review" };
  }
  if (/\b(?:powershell|pwsh)(?:\.exe)?\b[^;&|]*(?:-command|-c)\b/i.test(command)) {
    return { rule: "nested-shell", reason: "Nested shell commands require review" };
  }
  return null;
}

function targetsPrivateNetwork(command: string): boolean {
  const value = command.toLowerCase();
  const blockedHostPatterns = [
    /\b(?:localhost|metadata\.google\.internal)\b/,
    /\b127(?:\.\d{1,3}){0,3}\b/,
    /\b10(?:\.\d{1,3}){3}\b/,
    /\b169\.254(?:\.\d{1,3}){2}\b/,
    /\b172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}\b/,
    /\b192\.168(?:\.\d{1,3}){2}\b/,
    /\[?::1\]?\b/,
    /\b0xa9fea9fe\b/,
    /\b2852039166\b/,
    /\b0251\.0376\.0251\.0376\b/
  ];
  return blockedHostPatterns.some((pattern) => pattern.test(value));
}

function extractCommandNames(command: string): string[] {
  const segments = command
    .split(/(?:&&|\|\||[;|])/)
    .map((part) => part.trim())
    .filter(Boolean);
  const names: string[] = [];
  for (const segment of segments) {
    const tokens = segment.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
    const first = tokens.find((token) => !isShellAssignment(token) && !isShellRedirect(token));
    if (!first) continue;
    names.push(first.replace(/^['"]|['"]$/g, ""));
  }
  return names;
}

function isShellAssignment(token: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*=/.test(token);
}

function isShellRedirect(token: string): boolean {
  return /^(?:\d?>|>>|<|2>|2>>)$/.test(token);
}
