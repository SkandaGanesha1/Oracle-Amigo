import { randomUUID } from "node:crypto";
import type { SandboxEvent } from "./SandboxEvents.js";
import type { SandboxRuntime, RawExecResult } from "./SandboxTypes.js";
import type { NetworkPolicyResult } from "../policy/NetworkPolicy.js";
import { SecretPolicy } from "../policy/SecretPolicy.js";

interface GondolinExecResult {
  exitCode?: number | null;
  stdout?: string;
  stderr?: string;
}

export interface GondolinSandboxOptions {
  network: NetworkPolicyResult;
  secretPolicy?: SecretPolicy;
  dryRun?: boolean;
  onNetworkDenied?: (event: Omit<SandboxEvent, "timestamp">) => void;
}

type GondolinVmLike = {
  exec(command: string, options?: { cwd?: string; signal?: AbortSignal }): PromiseLike<GondolinExecResult>;
  close(): Promise<void>;
};

export class GondolinSandbox implements SandboxRuntime {
  private vm: GondolinVmLike | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly dryRun: boolean;
  private readonly secretPolicy: SecretPolicy;

  private constructor(private readonly options: GondolinSandboxOptions) {
    this.dryRun = options.dryRun ?? process.env.SANDBOX_DRY_RUN === "true";
    this.secretPolicy = options.secretPolicy ?? new SecretPolicy();
  }

  static async create(options: GondolinSandboxOptions): Promise<GondolinSandbox> {
    const sandbox = new GondolinSandbox(options);
    await sandbox.initialize();
    return sandbox;
  }

  async exec(command: string, options: { timeoutMs?: number; workingDirectory?: string } = {}): Promise<RawExecResult> {
    if (this.dryRun) {
      return this.execDryRun(command);
    }

    const vm = this.vm;
    if (!vm) {
      throw new Error("Gondolin VM is not initialized");
    }

    const run = async (): Promise<RawExecResult> => {
      try {
        const result = await withTimeout(
          (signal) => vm.exec(command, { cwd: options.workingDirectory, signal }),
          options.timeoutMs ?? 30000
        );
        return {
          exitCode: result.exitCode ?? 0,
          stdout: this.secretPolicy.redactText(result.stdout ?? ""),
          stderr: this.secretPolicy.redactText(result.stderr ?? "")
        };
      } catch (error) {
        if (error instanceof TimeoutError) {
          return { exitCode: null, stdout: "", stderr: "Command timed out", timedOut: true };
        }
        return { exitCode: 1, stdout: "", stderr: error instanceof Error ? error.message : String(error) };
      }
    };

    const pending = this.queue.then(run, run);
    this.queue = pending.catch(() => undefined);
    return pending;
  }

  async close(): Promise<void> {
    await this.queue.catch(() => undefined);
    if (this.vm) {
      await this.vm.close();
      this.vm = null;
    }
  }

  private async initialize(): Promise<void> {
    if (this.dryRun) {
      return;
    }

    const gondolin = (await import("@earendil-works/gondolin")) as unknown as {
      VM: { create(options?: Record<string, unknown>): Promise<GondolinVmLike> };
      MemoryProvider?: new () => unknown;
      createHttpHooks?: (options: Record<string, unknown>) => Record<string, unknown>;
    };

    const secrets = this.secretPolicy.getHostScopedSecrets();
    const hookFactory = gondolin.createHttpHooks;
    const hookConfig = hookFactory
      ? hookFactory({
          allowedHosts: this.options.network.allowedHosts,
          secrets,
          isRequestAllowed: (request: Request) => this.isRequestAllowed(request)
        })
      : {};

    const vfs = gondolin.MemoryProvider ? { mounts: { "/workspace": new gondolin.MemoryProvider() } } : undefined;

    this.vm = await gondolin.VM.create({
      ...hookConfig,
      vfs
    });
  }

  private async execDryRun(command: string): Promise<RawExecResult> {
    if (command.includes("uname -a")) {
      return { exitCode: 0, stdout: "Linux gondolin-dry-run 6.8.0 #1 SMP PREEMPT_DYNAMIC x86_64 GNU/Linux\n", stderr: "" };
    }
    if (/\bnode\s+--version\b/.test(command)) {
      return { exitCode: 0, stdout: "v24.0.0\n", stderr: "" };
    }
    if (/\bnpm\s+--version\b/.test(command)) {
      return { exitCode: 0, stdout: "11.0.0\n", stderr: "" };
    }
    if (command.includes("/tmp/agent_task.mjs")) {
      return { exitCode: 0, stdout: "hello from generated node code\n", stderr: "" };
    }
    if (command.includes("/tmp/agent_task.py")) {
      return { exitCode: 0, stdout: "hello from generated python code\n", stderr: "" };
    }
    if (/git\s+clone\s+/.test(command)) {
      return { exitCode: 0, stdout: "Cloning into '/workspace/repo'...\n", stderr: "" };
    }
    if (/\b(vitest|pytest|npm\s+test)\b/.test(command)) {
      return { exitCode: 0, stdout: "dry-run tests passed\n", stderr: "" };
    }

    return { exitCode: 0, stdout: `dry-run executed: ${randomUUID()}\n`, stderr: "" };
  }

  private isRequestAllowed(request: Request): boolean {
    const host = new URL(request.url).hostname.toLowerCase();
    const allowed = this.options.network.allowedHosts.some((allowedHost) => host === allowedHost.toLowerCase());
    if (!allowed) {
      this.options.onNetworkDenied?.({
        type: "network.denied",
        message: `Network request denied for host ${host}`,
        metadata: { host }
      });
    }
    return allowed;
  }
}

class TimeoutError extends Error {}

function withTimeout<T>(run: (signal: AbortSignal) => PromiseLike<T>, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout;
  return Promise.race([
    Promise.resolve(run(controller.signal)),
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new TimeoutError("Timed out"));
      }, timeoutMs);
    })
  ]).finally(() => clearTimeout(timer));
}
