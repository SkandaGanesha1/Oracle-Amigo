import { createHash, createSign } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import {
  AgentDecisionSchema,
  HeuristicAgentReasoner,
  type AgentDecision,
  type AgentReasoner,
  type AgentReasoningContext
} from "../agent-runs/AgentDecision.js";

type OciProfile = Record<string, string>;

export class OciGenAiClient implements AgentReasoner {
  private readonly endpoint = requireEnv("OCI_GENAI_SERVICE_ENDPOINT").replace(/\/$/, "");
  private readonly modelId = requireEnv("OCI_GENAI_MODEL_ID");
  private readonly compartmentId = requireEnv("OCI_GENAI_COMPARTMENT_ID");
  private readonly projectId = process.env.OCI_GENAI_PROJECT_ID;

  async reasonNextAction(context: AgentReasoningContext): Promise<AgentDecision> {
    const responseText = await this.callResponsesApi(context);
    const json = extractJson(responseText);
    return AgentDecisionSchema.parse(JSON.parse(json));
  }

  private async callResponsesApi(context: AgentReasoningContext): Promise<string> {
    const url = new URL("/openai/v1/responses", this.endpoint);
    const body = JSON.stringify({
      model: this.modelId,
      input: [
        {
          role: "system",
          content: buildSystemPrompt()
        },
        {
          role: "user",
          content: JSON.stringify(redactContext(context))
        }
      ],
      temperature: 0,
      max_output_tokens: 1200,
      store: false
    });

    const headers: Record<string, string> = {
      "content-type": "application/json",
      "opc-compartment-id": this.compartmentId
    };
    if (this.projectId) {
      headers["OpenAI-Project"] = this.projectId;
    }

    const apiKey = process.env.OCI_GENAI_API_KEY;
    if (apiKey) {
      headers.authorization = `Bearer ${apiKey}`;
    } else {
      Object.assign(headers, await signOciRequest("post", url, body));
    }

    const response = await fetch(url, {
      method: "POST",
      headers,
      body
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`OCI GenAI request failed with HTTP ${response.status}: ${sanitizeError(text)}`);
    }

    const payload = (await response.json()) as Record<string, unknown>;
    const outputText = extractResponseText(payload);
    if (!outputText) throw new Error("OCI GenAI response did not contain text output.");
    return outputText;
  }
}

export function createDefaultReasoner(): AgentReasoner {
  if (process.env.NODE_ENV === "test" || process.env.VITEST) {
    return new HeuristicAgentReasoner();
  }
  if (process.env.OCI_GENAI_MODEL_ID && process.env.OCI_GENAI_SERVICE_ENDPOINT && process.env.OCI_GENAI_COMPARTMENT_ID) {
    return new OciGenAiClient();
  }
  return new HeuristicAgentReasoner();
}

function buildSystemPrompt(): string {
  return [
    "You are the reasoning brain for a local file-search agent.",
    "Return ONLY strict JSON matching one AgentDecision. No markdown, no prose.",
    "Available decisions:",
    '{"type":"semantic_search","reason":"...","query":"...","roots":["optional"],"fileTypes":["optional"]}',
    '{"type":"execute_command","reason":"...","tool":"host-file-search","command":"safe PowerShell search command","cwd":"optional","timeoutMs":30000}',
    '{"type":"execute_command","reason":"...","tool":"gondolin-vm-command","command":"safe VM command","cwd":"optional","timeoutMs":30000}',
    '{"type":"final_answer","reason":"...","status":"found|not_found|need_help","message":"...","selectedFileId":"optional"}',
    "Prefer semantic_search first unless the previous observations prove a command is necessary.",
    "Host commands must be read-only file-search commands only: Get-Location, Test-Path, Resolve-Path, Get-ChildItem, where.exe.",
    "Host commands must be one simple command: no pipes, ampersands, semicolons, Where-Object, ForEach-Object, Select-Object, command substitution, or chained commands.",
    "Do not run broad recursive scans such as '*.pdf' across many roots; use semantic_search or a narrow filename filter with request-specific terms.",
    "Never request secrets, environment variables, network calls, writes, deletes, uploads, registry edits, admin actions, or destructive commands.",
    "If a match exists in fileSearch.selectedMatch, return final_answer with status found."
  ].join("\n");
}

function redactContext(context: AgentReasoningContext) {
  return {
    runId: context.runId,
    query: context.query,
    searchedRoots: context.searchedRoots,
    sandboxSessionAvailable: Boolean(context.sandboxSessionId),
    iterations: context.iterations.map((iteration) => ({
      iteration: iteration.iteration,
      decision: iteration.decision,
      status: iteration.status,
      summary: iteration.summary,
      stdout: truncate(iteration.stdout),
      stderr: truncate(iteration.stderr)
    })),
    fileSearch: context.fileSearch
      ? {
          status: context.fileSearch.status,
          parsedFileName: context.fileSearch.parsedFileName,
          matches: context.fileSearch.matches.slice(0, 10).map((match) => ({
            id: match.id,
            fileName: match.fileName,
            directory: match.directory,
            score: match.score,
            reason: match.reason
          })),
          selectedMatch: context.fileSearch.selectedMatch
            ? {
                id: context.fileSearch.selectedMatch.id,
                fileName: context.fileSearch.selectedMatch.fileName,
                directory: context.fileSearch.selectedMatch.directory,
                score: context.fileSearch.selectedMatch.score
              }
            : null
        }
      : null
  };
}

export async function signOciRequest(method: string, url: URL, body: string): Promise<Record<string, string>> {
  const profile = await readOciProfile();
  const tenancy = requireProfile(profile, "tenancy");
  const user = requireProfile(profile, "user");
  const fingerprint = requireProfile(profile, "fingerprint");
  const keyFile = resolvePath(requireProfile(profile, "key_file"));
  const privateKey = await readFile(keyFile, "utf8");
  const date = new Date().toUTCString();
  const contentSha = createHash("sha256").update(body).digest("base64");
  const path = `${url.pathname}${url.search}`;
  const signingHeaders = {
    date,
    "(request-target)": `${method.toLowerCase()} ${path}`,
    host: url.host,
    "content-length": Buffer.byteLength(body).toString(),
    "content-type": "application/json",
    "x-content-sha256": contentSha
  };
  const headerNames = Object.keys(signingHeaders);
  const signingString = headerNames.map((name) => `${name}: ${signingHeaders[name as keyof typeof signingHeaders]}`).join("\n");
  const signer = createSign("RSA-SHA256");
  signer.update(signingString);
  signer.end();
  const signature = signer.sign(privateKey, "base64");
  return {
    date,
    host: url.host,
    "content-length": Buffer.byteLength(body).toString(),
    "x-content-sha256": contentSha,
    authorization: `Signature version="1",keyId="${tenancy}/${user}/${fingerprint}",algorithm="rsa-sha256",headers="${headerNames.join(
      " "
    )}",signature="${signature}"`
  };
}

async function readOciProfile(): Promise<OciProfile> {
  const configFile = resolvePath(process.env.OCI_CONFIG_FILE ?? "~/.oci/config");
  const profileName = process.env.OCI_CONFIG_PROFILE ?? "DEFAULT";
  const content = await readFile(configFile, "utf8");
  const profile: OciProfile = {};
  let active = false;
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const section = line.match(/^\[(.+)]$/);
    if (section) {
      active = section[1] === profileName;
      continue;
    }
    if (!active) continue;
    const separator = line.indexOf("=");
    if (separator === -1) continue;
    profile[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return profile;
}

function extractResponseText(payload: Record<string, unknown>): string | null {
  if (typeof payload.output_text === "string") return payload.output_text;
  const output = payload.output;
  if (!Array.isArray(output)) return null;
  const chunks: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== "object" || !("content" in item)) continue;
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      const text = (part as { text?: unknown }).text;
      if (typeof text === "string") chunks.push(text);
    }
  }
  return chunks.join("\n") || null;
}

function extractJson(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) return trimmed;
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) return trimmed.slice(first, last + 1);
  throw new Error("OCI GenAI did not return JSON.");
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for OCI GenAI.`);
  return value;
}

function requireProfile(profile: OciProfile, name: string): string {
  const value = profile[name];
  if (!value) throw new Error(`OCI config profile is missing ${name}.`);
  return value;
}

function resolvePath(path: string): string {
  return path.replace(/^~(?=$|[\\/])/, homedir());
}

function truncate(value?: string): string | undefined {
  if (!value) return value;
  return value.length > 3000 ? `${value.slice(0, 3000)}\n[truncated]` : value;
}

function sanitizeError(value: string): string {
  return truncate(value.replace(/(authorization|private_key|fingerprint|token|secret|password)[^,\n]*/gi, "$1=[redacted]")) ?? "";
}
