import type { SandboxEvent } from "../sandbox/SandboxEvents.js";
import { SandboxTool } from "../agent-tools/SandboxTool.js";

export async function runGeneratedCodeSafetyDemo(tool = new SandboxTool()): Promise<void> {
  const print = (line: string) => console.log(line);

  tool.sessions.eventBus.on("event", (event: SandboxEvent) => {
    const label = event.type.startsWith("command.policy") || event.type.startsWith("command.blocked") ? "policy" : "sandbox";
    print(`[${label}] ${event.message}`);
  });

  print("[agent] Creating sandbox...");
  const session = await tool.createSandboxSession({
    purpose: "Analyze and test unknown generated code safely",
    networkProfile: "npm",
    ttlSeconds: 600
  });

  print("[agent] Running environment check...");
  await tool.runShellCommand({ sessionId: session.sessionId, command: "uname -a" });

  print("[agent] Running Node.js generated code...");
  await tool.runNodeCode({
    sessionId: session.sessionId,
    code: "console.log('hello from generated node code')"
  });

  print("[agent] Running Python generated code...");
  await tool.runPythonCode({
    sessionId: session.sessionId,
    code: "print('hello from generated python code')"
  });

  print("[agent] Testing policy block...");
  const blocked = await tool.runShellCommand({ sessionId: session.sessionId, command: "rm -rf /" });
  print(`[agent] Dangerous command result: ${blocked.status}`);

  print("[agent] Checking package runtime...");
  await tool.runShellCommand({ sessionId: session.sessionId, command: "npm --version" });

  print("[agent] Closing sandbox...");
  await tool.closeSandboxSession({ sessionId: session.sessionId });
}
