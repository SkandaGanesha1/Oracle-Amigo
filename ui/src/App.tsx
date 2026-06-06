import { useCallback, useMemo, useRef, useState } from "react";
import { AgentPlan, type PlanStatus, type PlanSubtask, type PlanTask } from "@/components/ui/agent-plan";
import { PromptInputBox } from "@/components/ui/ai-prompt-box";
import { FileText } from "lucide-react";
import { ShaderBackground } from "./ShaderBackground";
import { AgentChatPanel } from "@/components/ui/agent-chat-panel";

type AgentCommand = {
  id: string;
  label: string;
  executionTarget: "agent-orchestrator" | "oci-llm" | "gondolin-vm-command" | "host-file-search";
  command?: string;
  status: "running" | "completed" | "failed" | "skipped";
  stdout: string;
  stderr?: string;
  durationMs: number;
  sessionId?: string;
};

type FileMatch = {
  id: string;
  fileName: string;
  directory: string;
  extension?: string;
  sizeBytes: number;
  modifiedAt: string;
  score?: number;
  reason?: string;
  previewUrl: string;
};

type FileSearchResult = {
  planId: string;
  query: string;
  status: "found" | "not_found";
  parsedFileName: string | null;
  terminal: {
    shell: "PowerShell";
    cwd: string;
    executionMode: "sandbox-file-search";
  };
  roots: string[];
  matches: FileMatch[];
  selectedMatch: FileMatch | null;
};

type AgentRunResult = {
  runId: string;
  query: string;
  createdAt: string;
  updatedAt: string;
  status: "running" | "completed" | "partial" | "failed";
  reasoningMode?: "oci-agent-loop";
  searchedRoots?: string[];
  iterations?: unknown[];
  sandboxSession: {
    requested: boolean;
    created: boolean;
    sessionId: string | null;
    networkProfile: string | null;
    error?: string;
  };
  steps: AgentCommand[];
  fileSearch: FileSearchResult | null;
  finalAnswer?: { status: "found" | "not_found" | "need_help"; message: string; selectedFileId?: string } | null;
};

export function App() {
  const [activeTab, setActiveTab] = useState<"agent-runner" | "agent-chat">("agent-runner");
  const [isLoading, setIsLoading] = useState(false);
  const [submittedQuery, setSubmittedQuery] = useState<string | null>(null);
  const [result, setResult] = useState<AgentRunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  const closeRunStream = useCallback(() => {
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
  }, []);

  const handleSendMessage = useCallback(
    async (message: string, files?: File[]) => {
      if (files && files.length > 0) {
        console.log("Files attached to prompt:", files);
      }
      abortRef.current?.abort();
      closeRunStream();
      const controller = new AbortController();
      abortRef.current = controller;
      setSubmittedQuery(message);
      setResult(null);
      setError(null);
      setIsLoading(true);

      try {
        const response = await fetch("/agent/runs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: message }),
          signal: controller.signal
        });
        if (!response.ok) {
          const details = await response.json().catch(() => ({}));
          throw new Error(details.error ?? `Search failed with HTTP ${response.status}`);
        }

        const initialRun = (await response.json()) as AgentRunResult;
        setResult(initialRun);
        setIsLoading(initialRun.status === "running");

        const stream = new EventSource(`/agent/runs/${initialRun.runId}/events`);
        eventSourceRef.current = stream;
        stream.addEventListener("snapshot", (event) => {
          const nextRun = JSON.parse((event as MessageEvent).data) as AgentRunResult;
          setResult(nextRun);
          if (nextRun.status !== "running") {
            setIsLoading(false);
            stream.close();
            if (eventSourceRef.current === stream) eventSourceRef.current = null;
          }
        });
        stream.onerror = () => {
          if (eventSourceRef.current === stream) {
            setError("Lost live progress stream. The latest run snapshot is still available from the backend.");
            setIsLoading(false);
            stream.close();
            eventSourceRef.current = null;
          }
        };
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setError(caught instanceof Error ? caught.message : "Search failed.");
        setIsLoading(false);
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
        }
      }
    },
    [closeRunStream]
  );

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    closeRunStream();
    setIsLoading(false);
  }, [closeRunStream]);

  const tasks = useMemo(() => buildPlanTasks(result, submittedQuery), [result, submittedQuery]);
  const activeSubtaskId = useMemo(() => findActiveSubtaskId(result), [result]);
  const selectedMatch = result?.fileSearch?.selectedMatch ?? null;
  const showPromptPlan = Boolean(submittedQuery || result || error || isLoading);
  const hasResults = Boolean(
    submittedQuery ||
      result ||
      error ||
      isLoading
  );

  return (
    <main className="relative min-h-screen w-full bg-black px-4 py-8 text-white">
      <ShaderBackground />
      <div className="relative z-10 mx-auto mb-4 flex w-full max-w-6xl justify-center gap-2">
        <button
          type="button"
          onClick={() => setActiveTab("agent-runner")}
          className={`rounded px-4 py-1.5 text-xs font-medium transition ${
            activeTab === "agent-runner"
              ? "bg-white/15 text-white"
              : "bg-white/5 text-white/50 hover:bg-white/10"
          }`}
        >
          Agent Runner
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("agent-chat")}
          className={`rounded px-4 py-1.5 text-xs font-medium transition ${
            activeTab === "agent-chat"
              ? "bg-white/15 text-white"
              : "bg-white/5 text-white/50 hover:bg-white/10"
          }`}
        >
          Agent Chat
        </button>
      </div>
      <div
        className={`relative z-10 mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-6xl flex-col items-center gap-5 ${
          hasResults ? "justify-start pt-6" : "justify-center"
        }`}
      >
        <div className="w-full max-w-[560px]">
            <PromptInputBox
            isLoading={isLoading}
            onStop={handleStop}
            onSend={handleSendMessage}
            placeholder="Ask me to find a local file..."
          />
        </div>

        {activeTab === "agent-chat" && (
          <section className="w-full">
            <div className="mx-auto max-w-2xl">
              <AgentChatPanel />
            </div>
          </section>
        )}

        {activeTab === "agent-runner" && hasResults && (
          <section className="grid w-full gap-4 md:grid-cols-[minmax(340px,0.9fr)_minmax(380px,1.1fr)]">
            <div className="space-y-3">
              {showPromptPlan && <AgentPlan tasks={tasks} activeSubtaskId={activeSubtaskId} />}
              {error && (
                <div className="rounded-[8px] border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-100">
                  {error}
                </div>
              )}
            </div>
            <DocumentPreview
              match={selectedMatch}
              matches={result?.fileSearch?.matches ?? []}
              notFound={result?.fileSearch?.status === "not_found"}
            />
          </section>
        )}
      </div>
    </main>
  );
}

function buildPlanTasks(run: AgentRunResult | null, query: string | null): PlanTask[] {
  const steps = run?.steps ?? [];
  const fileSearch = run?.fileSearch ?? null;
  const agentSteps = steps.filter((step) => step.executionTarget === "agent-orchestrator");
  const llmSteps = steps.filter((step) => step.executionTarget === "oci-llm");
  const vmSteps = steps.filter((step) => step.executionTarget === "gondolin-vm-command");
  const hostSteps = steps.filter((step) => step.executionTarget === "host-file-search");
  const previewSteps = hostSteps.filter((step) => /preview|resolve-path/i.test(`${step.id} ${step.label} ${step.command ?? ""}`));
  const commandSteps = hostSteps.concat(vmSteps).filter((step) => step.command);
  const validateSteps = commandSteps.filter((step) => /policy|validate/i.test(`${step.id} ${step.label} ${step.stderr ?? ""}`));
  const executeSteps = commandSteps.filter((step) => !validateSteps.includes(step) && !previewSteps.includes(step));
  const semanticSteps = hostSteps.filter((step) => /semantic|search|inspect|Get-ChildItem|Test-Path/i.test(`${step.id} ${step.label} ${step.command ?? ""}`));
  const repeatedReasoning = llmSteps.slice(1);

  return [
    {
      id: "understand-request",
      title: "Understand Request",
      description: query ? `Create an observable OCI agent run for: ${query}` : "Waiting for the prompt.",
      status: taskStatus(agentSteps.concat(llmSteps.slice(0, 1))),
      priority: "high",
      level: 0,
      dependencies: [],
      subtasks: toSubtasks(agentSteps.concat(llmSteps.slice(0, 1)).length ? agentSteps.concat(llmSteps.slice(0, 1)) : placeholderStep("agent-plan-pending", "Waiting for prompt", "agent-orchestrator"))
    },
    {
      id: "plan-strategy",
      title: "Plan Search Strategy",
      description: `OCI LLM chooses tools using searched roots: ${(run?.searchedRoots ?? fileSearch?.roots ?? []).join(", ") || "pending"}`,
      status: taskStatus(llmSteps),
      priority: "high",
      level: 1,
      dependencies: ["request"],
      subtasks: toSubtasks(llmSteps.length ? llmSteps : placeholderStep("llm-pending", "Waiting for OCI LLM decision", "oci-llm"))
    },
    {
      id: "generate-command",
      title: "Generate Search Command",
      description: "Show LLM-selected terminal commands and semantic search actions.",
      status: taskStatus(commandSteps, semanticSteps.length ? "completed" : "pending"),
      priority: "medium",
      level: 1,
      dependencies: ["strategy"],
      subtasks: toSubtasks(commandSteps.length ? commandSteps : placeholderStep("command-pending", "Waiting for generated command", "host-file-search"))
    },
    {
      id: "validate-policy",
      title: "Validate Command Policy",
      description: "Block unsafe generated commands before they can touch the host.",
      status: validateSteps.length ? taskStatus(validateSteps) : commandSteps.length ? "completed" : "pending",
      priority: "high",
      level: 1,
      dependencies: ["command"],
      subtasks: toSubtasks(validateSteps.length ? validateSteps : placeholderStep("policy-pending", commandSteps.length ? "Generated commands passed policy" : "Waiting for command policy check", "host-file-search"))
    },
    {
      id: "execute-search",
      title: "Execute Terminal Search",
      description: "Run safe terminal and semantic search tools against local roots.",
      status: taskStatus(executeSteps.concat(semanticSteps), run ? "pending" : "pending"),
      priority: "high",
      level: 0,
      dependencies: ["policy"],
      subtasks: toSubtasks(executeSteps.concat(semanticSteps).length ? executeSteps.concat(semanticSteps) : placeholderStep("host-search-pending", "Waiting for local file search", "host-file-search"))
    },
    {
      id: "inspect-results",
      title: "Inspect Results",
      description: fileSearch?.selectedMatch
        ? `${fileSearch.selectedMatch.reason ?? "Best match"} (${Math.round((fileSearch.selectedMatch.score ?? 0) * 100)}%)`
        : "Rank matches by exact name, fuzzy name, path tokens, and extension.",
      status: fileSearch?.status === "found" ? "completed" : fileSearch?.status === "not_found" ? "failed" : "pending",
      priority: "medium",
      level: 1,
      dependencies: ["search"],
      subtasks: toSubtasks(semanticSteps.length ? semanticSteps : placeholderStep("inspect-pending", "Waiting for ranked search results", "host-file-search"))
    },
    {
      id: "reason-again",
      title: "Reason Again",
      description: "Feed command observations back to OCI LLM until final answer.",
      status: taskStatus(repeatedReasoning, run?.finalAnswer ? "completed" : "pending"),
      priority: "medium",
      level: 1,
      dependencies: ["inspect"],
      subtasks: toSubtasks(repeatedReasoning.length ? repeatedReasoning : placeholderStep("reason-again-pending", "Waiting for another OCI LLM decision", "oci-llm"))
    },
    {
      id: "preview",
      title: "Prepare PDF Preview",
      description: fileSearch?.selectedMatch
        ? `File found in ${fileSearch.selectedMatch.directory}`
        : "Prepare a PDF preview when the selected match is a PDF.",
      status: fileSearch?.status === "found" ? "completed" : fileSearch?.status === "not_found" ? "failed" : "pending",
      priority: "medium",
      level: 1,
      dependencies: ["final"],
      subtasks: toSubtasks(previewSteps.length ? previewSteps : placeholderStep("preview-pending", "Waiting for preview result", "host-file-search"))
    }
  ];
}

function placeholderStep(
  id: string,
  label: string,
  executionTarget: AgentCommand["executionTarget"],
  stderr?: string
): AgentCommand[] {
  return [
    {
      id,
      label,
      executionTarget,
      status: stderr ? "failed" : "running",
      stdout: stderr ? "" : "Pending.",
      stderr,
      durationMs: 0
    }
  ];
}

function toSubtasks(steps: AgentCommand[]): PlanSubtask[] {
  return steps.map((step) => {
    const priority: PlanSubtask["priority"] = step.status === "failed" ? "high" : "medium";
    return {
      id: step.id,
      title: step.label,
      description: step.command ? `Command: ${step.command}` : step.stdout || step.stderr || step.label,
      status: stepStatus(step.status),
      priority,
      tools: [step.executionTarget],
      command: step.command,
      stdout: step.stdout,
      stderr: step.stderr,
      durationMs: step.durationMs
    };
  });
}

function taskStatus(steps: AgentCommand[], emptyStatus: PlanStatus = "pending"): PlanStatus {
  if (steps.length === 0) return emptyStatus;
  if (steps.some((step) => step.status === "running")) return "in-progress";
  if (steps.some((step) => step.status === "failed")) return "failed";
  if (steps.some((step) => step.status === "skipped")) return "need-help";
  if (steps.every((step) => step.status === "completed")) return "completed";
  return "pending";
}

function stepStatus(status: AgentCommand["status"]): PlanStatus {
  if (status === "completed") return "completed";
  if (status === "running") return "in-progress";
  if (status === "failed") return "failed";
  if (status === "skipped") return "need-help";
  return "pending";
}

function findActiveSubtaskId(run: AgentRunResult | null): string | null {
  if (!run || run.steps.length === 0) return null;
  return run.steps.find((step) => step.status === "running")?.id ?? run.steps[run.steps.length - 1].id;
}

function DocumentPreview({ match, matches, notFound }: { match: FileMatch | null; matches: FileMatch[]; notFound: boolean }) {
  if (!match) {
    return (
      <div className="rounded-[8px] border border-white/10 bg-[#111214]/85 p-6 text-center text-sm text-white/55 shadow-2xl backdrop-blur">
        <div className="flex min-h-44 items-center justify-center">
          {notFound ? "No matching PDF was found in the allowed directories." : "PDF preview will load after a match is found."}
        </div>
      </div>
    );
  }

  if ((match.extension ?? "").toLowerCase() !== ".pdf") {
    return (
      <div className="rounded-[8px] border border-white/10 bg-[#111214]/85 p-5 text-sm text-white shadow-2xl backdrop-blur">
        <div className="flex items-center gap-2 font-medium">
          <FileText className="h-4 w-4 shrink-0" />
          <span className="truncate">{match.fileName}</span>
        </div>
        <p className="mt-2 break-words text-xs text-white/55">{match.directory}</p>
        <p className="mt-4 text-xs text-white/45">This file was found, but inline preview is currently available for PDF files only.</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-[8px] border border-white/10 bg-[#111214]/85 shadow-2xl backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 p-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-medium text-white">
            <FileText className="h-4 w-4 shrink-0" />
            <span className="truncate">{match.fileName}</span>
          </div>
          <p className="mt-1 break-words text-xs text-white/55">{match.directory}</p>
        </div>
        <div className="text-xs text-white/45">{formatBytes(match.sizeBytes)}</div>
      </div>
      <object
        aria-label={`Preview of ${match.fileName}`}
        data={match.previewUrl}
        type="application/pdf"
        className="h-[520px] w-full rounded-b-[8px] bg-white"
      >
        <a href={match.previewUrl}>Open PDF preview</a>
      </object>
      {matches.length > 0 && (
        <div className="border-t border-white/10 p-3">
          <h2 className="text-xs font-semibold uppercase tracking-normal text-white/50">Ranked matches</h2>
          <div className="mt-2 max-h-56 space-y-2 overflow-auto pr-1">
            {matches.map((candidate, index) => (
              <a
                key={candidate.id}
                href={candidate.previewUrl}
                target={candidate.extension?.toLowerCase() === ".pdf" ? "_blank" : undefined}
                rel="noreferrer"
                className={`block rounded-[8px] border p-2 text-left text-xs transition ${
                  candidate.id === match.id
                    ? "border-emerald-400/35 bg-emerald-400/10 text-emerald-50"
                    : "border-white/10 bg-black/20 text-white/65 hover:bg-white/10"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate font-medium">
                    {index + 1}. {candidate.fileName}
                  </span>
                  <span className="shrink-0 text-white/45">{Math.round((candidate.score ?? 0) * 100)}%</span>
                </div>
                <div className="mt-1 break-words text-white/40">{candidate.directory}</div>
                {candidate.reason && <div className="mt-1 text-white/45">{candidate.reason}</div>}
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
