import { createHash, randomUUID } from "node:crypto";
import type { ControlPlaneClient } from "./ControlPlaneClient.js";

export interface InitTransferRequest {
  to_agent_instance_id: string;
  file_name: string;
  file_size: number;
  sha256: string;
  relay_task_id?: string;
}

export interface InitTransferResult {
  transfer_id: string;
  status: string;
  upload_url: string;
  download_url: string;
  expires_at: string;
}

export interface UploadResult {
  ok: boolean;
  status: string;
}

export interface DownloadResult {
  body: Buffer;
  file_name: string;
  sha256: string;
  file_size: number;
}

export interface ReceiptRequest {
  stored_path: string;
  verified_sha256: string;
}

export class FileRelayClient {
  constructor(private cp: ControlPlaneClient) {}

  init(req: InitTransferRequest, deviceToken: string): Promise<InitTransferResult> {
    return this.cp.postJson<InitTransferResult>("/v1/transfers/init", req, deviceToken);
  }

  async upload(transferId: string, data: Buffer, deviceToken: string): Promise<UploadResult> {
    const r = await this.cp.putBuffer(`/v1/transfers/${encodeURIComponent(transferId)}/upload`, data, deviceToken);
    return r as UploadResult;
  }

  async download(transferId: string, deviceToken: string): Promise<DownloadResult> {
    const r = await this.cp.getBuffer(`/v1/transfers/${encodeURIComponent(transferId)}/download`, deviceToken);
    const body = r.body;
    const fileNameHeader = r.headers["x-content-filename"] ?? r.headers["content-disposition"] ?? "file";
    const fileName = String(fileNameHeader).replace(/^attachment; filename="?/, "").replace(/"?$/, "");
    const sha256 = r.headers["x-content-sha256"] ?? createHash("sha256").update(body).digest("hex");
    const fileSize = Number(r.headers["x-content-length"] ?? body.length);
    return { body, file_name: fileName, sha256, file_size: fileSize };
  }

  receipt(transferId: string, req: ReceiptRequest, deviceToken: string): Promise<{ ok: boolean; status: string }> {
    return this.cp.postJson<{ ok: boolean; status: string }>(`/v1/transfers/${encodeURIComponent(transferId)}/receipt`, req, deviceToken);
  }
}
