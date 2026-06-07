import { Agent as HttpAgent, request as httpRequest } from "node:http";
import { request as httpsRequest, Agent as HttpsAgent } from "node:https";
import { URL } from "node:url";

export interface CloudRequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  headers?: Record<string, string>;
  body?: string | Buffer | Uint8Array | null;
  timeoutMs?: number;
  /** opaque token for Authorization: Bearer */
  accessToken?: string;
  /** for raw octet-stream uploads */
  rawBuffer?: Buffer;
}

export class CloudError extends Error {
  constructor(public statusCode: number, public code: string, message: string, public body?: unknown) {
    super(message);
    this.name = "CloudError";
  }
}

export interface ParsedCloudResponse<T> {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: T;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Buffer.isBuffer(v);
}

function pickHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (typeof v === "string") out[k.toLowerCase()] = v;
  }
  return out;
}

export class ControlPlaneClient {
  private keepAliveAgents = new Map<string, HttpAgent | HttpsAgent>();

  constructor(public baseUrl: string) {}

  private agentFor(u: URL): HttpAgent | HttpsAgent {
    const key = u.host;
    const cached = this.keepAliveAgents.get(key);
    if (cached) return cached;
    const isHttps = u.protocol === "https:";
    const agent = isHttps
      ? new HttpsAgent({ keepAlive: true, maxSockets: 4 })
      : new HttpAgent({ keepAlive: true, maxSockets: 4 });
    this.keepAliveAgents.set(key, agent);
    return agent;
  }

  async request<T = unknown>(path: string, opts: CloudRequestOptions = {}): Promise<ParsedCloudResponse<T>> {
    const u = new URL(path, this.baseUrl);
    const isHttps = u.protocol === "https:";
    const lib = isHttps ? httpsRequest : httpRequest;
    const headers: Record<string, string> = {
      accept: "application/json",
      ...opts.headers
    };
    let body: Buffer | string | undefined;
    if (opts.rawBuffer) {
      body = opts.rawBuffer;
      headers["content-type"] = headers["content-type"] ?? "application/octet-stream";
    } else if (opts.body != null) {
      body = typeof opts.body === "string" ? opts.body : Buffer.from(opts.body);
      if (!headers["content-type"] && isPlainObject(JSON.parse("null"))) {
        // noop
      }
      if (!headers["content-type"] && typeof body === "string" && body.startsWith("{")) {
        headers["content-type"] = "application/json";
      } else if (!headers["content-type"]) {
        headers["content-type"] = "application/json";
      }
    }
    if (opts.accessToken) headers["authorization"] = `Bearer ${opts.accessToken}`;

    return new Promise((resolve, reject) => {
      const req = lib(
        {
          protocol: u.protocol,
          hostname: u.hostname,
          port: u.port,
          path: u.pathname + u.search,
          method: opts.method ?? "GET",
          headers,
          agent: this.agentFor(u),
          timeout: opts.timeoutMs ?? 30000
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => {
            const raw = Buffer.concat(chunks).toString("utf8");
            let parsed: unknown = raw;
            const ct = String(res.headers["content-type"] ?? "").toLowerCase();
            if (ct.includes("application/json") && raw.length > 0) {
              try { parsed = JSON.parse(raw); } catch { parsed = raw; }
            }
            const status = res.statusCode ?? 0;
            if (status >= 400) {
              const code = isPlainObject(parsed) && typeof parsed.error === "string" ? parsed.error : "HTTP_ERROR";
              const msg = isPlainObject(parsed) && typeof parsed.message === "string" ? parsed.message : `HTTP ${status}`;
              const issues = isPlainObject(parsed) && "issues" in parsed ? JSON.stringify(parsed.issues) : "";
              reject(new CloudError(status, code, `${msg}${issues ? " | " + issues : ""}`, parsed));
              return;
            }
            resolve({ status, headers: res.headers, body: parsed as T });
          });
        }
      );
      req.on("error", reject);
      req.on("timeout", () => {
        req.destroy(new Error(`Cloud request to ${path} timed out`));
      });
      if (body) req.write(body);
      req.end();
    });
  }

  async getJson<T = unknown>(path: string, accessToken?: string): Promise<T> {
    const r = await this.request<T>(path, { method: "GET", accessToken });
    return r.body;
  }

  async postJson<T = unknown>(path: string, jsonBody: unknown, accessToken?: string): Promise<T> {
    const r = await this.request<T>(path, {
      method: "POST",
      body: JSON.stringify(jsonBody),
      headers: { "content-type": "application/json" },
      accessToken
    });
    return r.body;
  }

  async putBuffer(path: string, buffer: Buffer, accessToken?: string): Promise<unknown> {
    const r = await this.request<unknown>(path, {
      method: "PUT",
      rawBuffer: buffer,
      headers: { "content-type": "application/octet-stream" },
      accessToken
    });
    return r.body;
  }

  async getBuffer(path: string, accessToken?: string): Promise<{ body: Buffer; headers: Record<string, string> }> {
    return new Promise((resolve, reject) => {
      const u = new URL(path, this.baseUrl);
      const isHttps = u.protocol === "https:";
      const lib = isHttps ? httpsRequest : httpRequest;
      const headers: Record<string, string> = { accept: "application/octet-stream, application/json, */*" };
      if (accessToken) headers["authorization"] = `Bearer ${accessToken}`;
      const req = lib({
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method: "GET",
        headers,
        agent: this.agentFor(u),
        timeout: 60000
      }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const buf = Buffer.concat(chunks);
          if ((res.statusCode ?? 0) >= 400) {
            const txt = buf.toString("utf8");
            try { reject(new CloudError(res.statusCode ?? 0, "HTTP_ERROR", txt, JSON.parse(txt))); }
            catch { reject(new CloudError(res.statusCode ?? 0, "HTTP_ERROR", txt, txt)); }
            return;
          }
          resolve({ body: buf, headers: pickHeaders(res.headers) });
        });
      });
      req.on("error", reject);
      req.on("timeout", () => req.destroy(new Error("timeout")));
      req.end();
    });
  }
}
