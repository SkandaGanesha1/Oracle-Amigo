import { z } from "zod";

export type LlmStructuredRequest<T> = {
  systemPrompt: string;
  userInput: unknown;
  schema: z.ZodSchema<T>;
  temperature?: number;
  maxOutputTokens?: number;
};

export interface LlmProvider {
  isAvailable(): boolean;
  generateStructured<T>(request: LlmStructuredRequest<T>): Promise<T>;
  generateEmbeddings(texts: string[], dimensions?: number): Promise<Float32Array[]>;
}

export class OciGenAiLlmProvider implements LlmProvider {
  private get endpoint(): string {
    return (process.env.OCI_GENAI_SERVICE_ENDPOINT ?? "").replace(/\/$/, "");
  }
  private get compartmentId(): string {
    return process.env.OCI_GENAI_COMPARTMENT_ID ?? "";
  }
  private get projectId(): string | undefined {
    return process.env.OCI_GENAI_PROJECT_ID;
  }

  isAvailable(): boolean {
    return !!(process.env.OCI_GENAI_MODEL_ID && process.env.OCI_GENAI_SERVICE_ENDPOINT && process.env.OCI_GENAI_COMPARTMENT_ID);
  }

  async generateEmbeddings(texts: string[], dimensions?: number): Promise<Float32Array[]> {
    if (!this.isAvailable()) throw new Error("OCI GenAI not configured");
    if (texts.length === 0) return [];
    const url = new URL("/openai/v1/embeddings", this.endpoint);
    const embeddingModelId = process.env.OCI_EMBEDDING_MODEL_ID ?? "openai.text-embedding-3-large";
    const body = JSON.stringify({
      model: embeddingModelId,
      input: texts,
      dimensions: dimensions ?? 384,
      encoding_format: "float"
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

    const response = await fetch(url, { method: "POST", headers, body });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`OCI GenAI embeddings failed with HTTP ${response.status}: ${text.slice(0, 200)}`);
    }
    const payload = (await response.json()) as { data: Array<{ embedding: number[] }> };
    return payload.data.map((d) => new Float32Array(d.embedding));
  }

  async generateStructured<T>(request: LlmStructuredRequest<T>): Promise<T> {
    if (!this.isAvailable()) throw new Error("OCI GenAI not configured");
    const endpoint = process.env.OCI_GENAI_SERVICE_ENDPOINT!.replace(/\/$/, "");
    const url = new URL("/openai/v1/responses", endpoint);
    const body = JSON.stringify({
      model: process.env.OCI_GENAI_MODEL_ID,
      input: [
        { role: "system", content: request.systemPrompt },
        { role: "user", content: typeof request.userInput === "string" ? request.userInput : JSON.stringify(request.userInput) },
      ],
      temperature: request.temperature ?? 0,
      max_output_tokens: request.maxOutputTokens ?? 600,
      store: false,
    });

    const headers: Record<string, string> = {
      "content-type": "application/json",
      "opc-compartment-id": process.env.OCI_GENAI_COMPARTMENT_ID!,
    };

    const apiKey = process.env.OCI_GENAI_API_KEY;
    if (apiKey) {
      headers.authorization = `Bearer ${apiKey}`;
    } else {
      // Fall back to instance principal / OCI config signing via the OciGenAiClient helper
      Object.assign(headers, await signOciRequest("post", url, body));
    }

    const response = await fetch(url, { method: "POST", headers, body });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`OCI GenAI HTTP ${response.status}: ${text.slice(0, 200)}`);
    }
    const payload = (await response.json()) as Record<string, unknown>;
    const outputText = extractResponseText(payload);
    if (!outputText) throw new Error("OCI GenAI response did not contain text output");

    const json = extractJson(outputText);
    return request.schema.parse(JSON.parse(json));
  }
}

export class FallbackLlmProvider implements LlmProvider {
  constructor(private readonly fallback: () => never) {}
  isAvailable(): boolean { return false; }
  generateStructured<T>(): Promise<T> { return this.fallback(); }
  generateEmbeddings(): Promise<Float32Array[]> { return this.fallback(); }
}

let cached: LlmProvider | null = null;

export function getLlmProvider(): LlmProvider {
  if (cached) return cached;
  const oci = new OciGenAiLlmProvider();
  if (oci.isAvailable()) {
    cached = oci;
    return cached;
  }
  cached = new FallbackLlmProvider(() => { throw new Error("LLM provider unavailable"); });
  return cached;
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
  throw new Error("LLM did not return JSON");
}

async function signOciRequest(method: string, url: URL, body: string): Promise<Record<string, string>> {
  // Lazy import to avoid hard dependency if not using OCI config signing
  const mod = await import("../oci/OciGenAiClient.js").catch(() => null) as { signOciRequest?: typeof signOciRequest } | null;
  if (mod?.signOciRequest) {
    return mod.signOciRequest(method, url, body);
  }
  throw new Error("OCI config signing requires OciGenAiClient — set OCI_GENAI_API_KEY or configure ~/.oci/config");
}
