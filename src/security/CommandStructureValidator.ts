import type { SecureCommandContext } from "./SecureCommandContext.js";

export interface CommandStructureDecision {
  allowed: boolean;
  reason: string;
  matchedRule?: string;
  classification?: string;
  riskScore: number;
  mitigations: string[];
}

export function validateCommandStructure(
  command: string,
  context: SecureCommandContext = { allowPrivateNetwork: false, allowRedirection: false }
): CommandStructureDecision {
  const findings: InternalDecision[] = [
    reject(/\0/, "null-byte", "Command contains a null byte", "command-injection"),
    reject(/[\u0001-\u0008\u000b\u000c\u000e-\u001f]/, "control-character", "Command contains unsafe control characters", "command-injection"),
    reject(/\$\(|<\(|>\(/, "command-substitution", "Command substitution requires review", "command-injection"),
    reject(/`/, "backtick-substitution", "Backtick shell syntax requires review", "command-injection"),
    reject(/\b(?:powershell|pwsh)(?:\.exe)?\b[^;&|]*(?:-encodedcommand|-enc)\b/i, "encoded-powershell", "Encoded PowerShell command is blocked", "credential-exfiltration"),
    reject(/\b(?:Invoke-Expression|iex)\b/i, "powershell-expression", "PowerShell expression evaluation is blocked", "command-injection"),
    reject(/\b(?:powershell|pwsh|bash|sh|cmd)(?:\.exe)?\b[^;&|]*(?:-command|-c|\/c)\b/i, "nested-shell", "Nested shell execution requires review", "command-injection"),
    reject(/\b(?:curl|wget|Invoke-WebRequest|Invoke-RestMethod|iwr|irm)\b[^;&|]*(?:file:\/\/|gopher:\/\/|ftp:\/\/)/i, "unsafe-url-scheme", "Unsafe URL scheme is blocked", "ssrf")
  ];

  if (!context.allowRedirection) {
    findings.push(
      reject(/(?:^|\s)(?:\d?>|>>|<|2>|2>>|&>|>\|)(?:\s|$)/, "shell-redirection", "Shell redirection requires an explicit secure context", "filesystem-write"),
      reject(/(?:^|\s)<<\s*\w+/, "heredoc", "Heredoc input requires review", "command-injection"),
      reject(/@['"]/, "powershell-herestring", "PowerShell here-string input requires review", "command-injection")
    );
  }

  const blocked = findings.find((finding) => !finding.allowed && finding.matchedRule && finding.pattern?.test(command));
  if (blocked) {
    const { pattern: _pattern, ...decision } = blocked;
    return decision;
  }

  return {
    allowed: true,
    reason: "Command structure passed validation",
    classification: "general",
    riskScore: 0,
    mitigations: []
  };
}

type InternalDecision = CommandStructureDecision & { pattern: RegExp };

function reject(pattern: RegExp, matchedRule: string, reason: string, classification: string): InternalDecision {
  return {
    allowed: false,
    reason,
    matchedRule,
    classification,
    riskScore: 90,
    mitigations: ["Use a direct allowlisted command entrypoint with explicit arguments."],
    pattern
  };
}
