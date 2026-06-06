import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { CommandPolicy } from "../policy/CommandPolicy.js";

const execFileAsync = promisify(execFile);

const SAFE_COMMAND_START = /^\s*(Get-Location|Test-Path|Resolve-Path|Get-ChildItem|where\.exe)\b/i;
const SHELL_CONTROL_OPERATORS = /[|;&`]/;
const BLOCKED_TOKENS =
  /\b(Remove-Item|rm|del|erase|Set-Content|Add-Content|Out-File|New-Item|Move-Item|Copy-Item|Rename-Item|Invoke-WebRequest|curl|wget|Start-Process|Stop-Process|Set-ItemProperty|reg|Format-Volume|Get-ChildItem\s+Env:|Get-Content|Where-Object|ForEach-Object|Select-Object)\b/i;

export type HostCommandResult = {
  command: string;
  status: "succeeded" | "failed" | "blocked" | "timed_out";
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
};

export class HostSearchCommandRunner {
  constructor(private readonly commandPolicy = new CommandPolicy()) {}

  async run(command: string, options: { cwd?: string; timeoutMs?: number } = {}): Promise<HostCommandResult> {
    const policy = this.evaluate(command);
    if (!policy.allowed) {
      return {
        command,
        status: "blocked",
        exitCode: null,
        stdout: "",
        stderr: policy.reason,
        durationMs: 0
      };
    }

    const startedAt = Date.now();
    const timeoutMs = this.commandPolicy.capTimeout(options.timeoutMs ?? 30000);
    try {
      const result = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], {
        cwd: options.cwd ? resolve(options.cwd) : process.cwd(),
        timeout: timeoutMs,
        maxBuffer: 1024 * 1024
      });
      return {
        command,
        status: "succeeded",
        exitCode: 0,
        stdout: result.stdout,
        stderr: result.stderr,
        durationMs: Date.now() - startedAt
      };
    } catch (error) {
      const failed = error as { code?: number | string; stdout?: string; stderr?: string; killed?: boolean };
      return {
        command,
        status: failed.killed ? "timed_out" : "failed",
        exitCode: typeof failed.code === "number" ? failed.code : null,
        stdout: failed.stdout ?? "",
        stderr: failed.stderr ?? String(error),
        durationMs: Date.now() - startedAt
      };
    }
  }

  evaluate(command: string): { allowed: boolean; reason: string } {
    const policy = this.commandPolicy.evaluate(command);
    if (!policy.allowed) return { allowed: false, reason: policy.reason };
    if (SHELL_CONTROL_OPERATORS.test(command)) {
      return { allowed: false, reason: "Host file-search commands must be a single simple read-only command without pipes, ampersands, semicolons, or command substitution." };
    }
    if (BLOCKED_TOKENS.test(command)) {
      return { allowed: false, reason: "Host file-search commands must be read-only and cannot read secrets, write files, or use network/process control." };
    }
    if (!SAFE_COMMAND_START.test(command)) {
      return { allowed: false, reason: "Only read-only file-search commands are allowed on the host." };
    }
    if (isBroadRecursivePdfScan(command)) {
      return { allowed: false, reason: "Broad recursive PDF scans are blocked; use semantic_search or a narrower filename filter." };
    }
    return { allowed: true, reason: "Host file-search command allowed by policy" };
  }
}

function isBroadRecursivePdfScan(command: string): boolean {
  const value = command.toLowerCase();
  if (!/\b(get-childitem|where\.exe)\b/.test(value)) return false;
  if (!/(?:\s|^)(-recurse|\/r)\b/.test(value)) return false;
  const broadPdfOnly = /(\*\.pdf|\.pdf\b)/.test(value) && !/(non|po|nonpo|invoice|india|offer|roadmap|contract|report|statement|resume)/.test(value);
  const missingFilter = value.includes("get-childitem") && !/(?:^|\s)-(?:filter|include)\b/.test(value);
  return broadPdfOnly || missingFilter;
}
