import { spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import sharp from "sharp";

export interface RenderedPdfThumbnail {
  width: number;
  height: number;
}

export class PopplerPdfRenderer {
  async renderFirstPage(inputPath: string, output: { thumb360Path: string; thumb720Path: string }): Promise<RenderedPdfThumbnail> {
    const tempDir = await mkdtemp(join(tmpdir(), "oa-pdf-preview-"));
    const pngBase = join(tempDir, "page");
    const pngPath = `${pngBase}.png`;
    try {
      await runPdftoppm(inputPath, pngBase);
      mkdirSync(dirname(output.thumb360Path), { recursive: true });
      await sharp(pngPath)
        .rotate()
        .resize({ width: 720, height: 720, fit: "inside", withoutEnlargement: true })
        .webp({ quality: 82 })
        .toFile(output.thumb720Path);
      const metadata = await sharp(output.thumb720Path).metadata();
      await sharp(pngPath)
        .rotate()
        .resize({ width: 360, height: 360, fit: "inside", withoutEnlargement: true })
        .webp({ quality: 82 })
        .toFile(output.thumb360Path);
      return { width: metadata.width ?? 720, height: metadata.height ?? 720 };
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
}

function runPdftoppm(inputPath: string, outputBase: string): Promise<void> {
  const timeoutMs = Number(process.env.PDF_PREVIEW_RENDER_TIMEOUT_MS ?? 15000);
  return new Promise((resolve, reject) => {
    const child = spawn("pdftoppm", [
      "-f", "1",
      "-l", "1",
      "-singlefile",
      "-png",
      "-scale-to", "1200",
      inputPath,
      outputBase
    ], {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"]
    });
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("PDF thumbnail rendering timed out"));
    }, timeoutMs);
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`pdftoppm is unavailable: ${err.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`pdftoppm failed with exit code ${code}${stderr ? `: ${stderr.trim()}` : ""}`));
      }
    });
  });
}
