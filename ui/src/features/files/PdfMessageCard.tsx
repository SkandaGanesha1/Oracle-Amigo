import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ChevronLeft, ChevronRight, Download, FileText, Loader2, Maximize2, Minus, Plus, ShieldAlert, X } from "lucide-react";
import type { MessageAttachment } from "../../api/types";
import { filesApi } from "../../api/filesApi";

function formatSize(sizeBytes?: number | null): string | null {
  if (!sizeBytes || !Number.isFinite(sizeBytes)) return null;
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function isPdfAttachment(attachment: MessageAttachment): boolean {
  return attachment.mime_type?.toLowerCase() === "application/pdf" || attachment.file_name?.toLowerCase().endsWith(".pdf");
}

function attachmentFileId(attachment: MessageAttachment): string | null {
  if (attachment.id) return attachment.id;
  const match = attachment.url?.match(/\/storage\/files\/([^/]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export function PdfMessageCard({ attachment }: { attachment: MessageAttachment }) {
  const fileId = attachmentFileId(attachment);
  const [viewerOpen, setViewerOpen] = useState(false);
  const statusFromPayload = attachment.preview_status;
  const thumbnail = useQuery({
    queryKey: ["files", "pdf-thumbnail-url", fileId, "360"],
    queryFn: () => filesApi.thumbnailUrl(fileId!, "360"),
    enabled: Boolean(fileId) && attachment.scan_state !== "blocked",
    refetchInterval: (query) => query.state.data?.preview.status === "processing" ? 2000 : false,
    staleTime: 45_000
  });
  const preview = thumbnail.data?.preview;
  const status = preview?.status ?? statusFromPayload ?? "processing";
  const name = attachment.file_name || "PDF document";
  const size = formatSize(attachment.size_bytes);
  const pageCount = preview?.page_count ?? attachment.page_count ?? null;
  const downloadHref = attachment.url || (fileId ? filesApi.downloadUrl(fileId) : undefined);
  const thumbnailUrl = thumbnail.data?.url ?? null;

  if (attachment.scan_state === "blocked" || status === "blocked") {
    return (
      <div className="flex min-h-[76px] max-w-[360px] items-center gap-3 rounded-lg border border-oa-red/30 bg-oa-red/10 p-3 text-xs text-oa-red">
        <ShieldAlert className="h-5 w-5 shrink-0" aria-hidden="true" />
        <div className="min-w-0">
          <div className="truncate font-medium">{name}</div>
          <div className="mt-1 text-oa-red/80">Blocked by file safety validation</div>
        </div>
      </div>
    );
  }

  const isReady = status === "ready" && Boolean(thumbnailUrl);

  return (
    <>
      <div className="w-full max-w-[360px] overflow-hidden rounded-lg border border-oa-border bg-oa-surface/80 text-oa-text shadow-sm">
        <button
          type="button"
          onClick={() => isReady && setViewerOpen(true)}
          disabled={!isReady}
          className="group block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue disabled:cursor-default"
          aria-label={isReady ? `Open ${name}` : `${name} preview is ${status}`}
        >
          <div className="relative flex aspect-[4/3] w-full items-center justify-center bg-oa-bg-elevated">
            {isReady ? (
              <>
                <img src={thumbnailUrl!} alt="" className="h-full w-full object-contain" loading="lazy" />
                <span className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-lg bg-black/55 text-white opacity-0 transition-opacity group-hover:opacity-100">
                  <Maximize2 className="h-4 w-4" aria-hidden="true" />
                </span>
              </>
            ) : status === "failed" ? (
              <div className="flex flex-col items-center gap-2 text-oa-text-muted">
                <AlertTriangle className="h-6 w-6 text-oa-amber" aria-hidden="true" />
                <span className="text-xs">Preview unavailable</span>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 text-oa-text-muted">
                <Loader2 className="h-6 w-6 animate-spin text-oa-blue" aria-hidden="true" />
                <span className="text-xs">Preparing preview</span>
              </div>
            )}
          </div>
        </button>
        <div className="flex items-center gap-3 border-t border-oa-border px-3 py-2.5">
          <FileText className="h-4 w-4 shrink-0 text-oa-red" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-medium">{name}</div>
            <div className="mt-0.5 flex gap-2 text-[10px] text-oa-text-disabled">
              {pageCount ? <span>{pageCount} page{pageCount === 1 ? "" : "s"}</span> : null}
              {size ? <span>{size}</span> : null}
            </div>
          </div>
          {downloadHref && (
            <a
              href={downloadHref}
              download
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-oa-text-muted hover:bg-oa-surface-2 hover:text-oa-text"
              aria-label={`Download ${name}`}
            >
              <Download className="h-4 w-4" aria-hidden="true" />
            </a>
          )}
        </div>
      </div>
      {viewerOpen && fileId && (
        <PdfViewerModal fileId={fileId} fileName={name} downloadHref={downloadHref} onClose={() => setViewerOpen(false)} />
      )}
    </>
  );
}

function PdfViewerModal({ fileId, fileName, downloadHref, onClose }: { fileId: string; fileName: string; downloadHref?: string; onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [scale, setScale] = useState(1.1);
  const [renderError, setRenderError] = useState<string | null>(null);
  const viewer = useQuery({
    queryKey: ["files", "pdf-viewer-url", fileId],
    queryFn: () => filesApi.viewerUrl(fileId),
    staleTime: 45_000
  });
  const url = viewer.data?.url;

  useEffect(() => {
    let cancelled = false;
    async function render() {
      if (!url || !canvasRef.current) return;
      setRenderError(null);
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.mjs", import.meta.url).toString();
        const task = pdfjs.getDocument({ url, withCredentials: true });
        const pdf = await task.promise;
        if (cancelled) return;
        setPageCount(pdf.numPages);
        const page = await pdf.getPage(Math.min(pageNumber, pdf.numPages));
        if (cancelled) return;
        const viewport = page.getViewport({ scale });
        const canvas = canvasRef.current;
        const context = canvas.getContext("2d");
        if (!context) return;
        const deviceScale = window.devicePixelRatio || 1;
        canvas.width = Math.floor(viewport.width * deviceScale);
        canvas.height = Math.floor(viewport.height * deviceScale);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        context.setTransform(deviceScale, 0, 0, deviceScale, 0, 0);
        renderTaskRef.current?.cancel();
        const renderTask = page.render({ canvas, canvasContext: context, viewport });
        renderTaskRef.current = renderTask;
        await renderTask.promise;
      } catch (err) {
        if (!cancelled) setRenderError(err instanceof Error ? err.message : "Unable to render PDF");
      }
    }
    void render();
    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel();
      renderTaskRef.current = null;
    };
  }, [pageNumber, scale, url]);

  const canPrev = pageNumber > 1;
  const canNext = pageNumber < pageCount;
  const zoomLabel = useMemo(() => `${Math.round(scale * 100)}%`, [scale]);

  return (
    <div className="fixed inset-0 z-[120] flex flex-col bg-black/75 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={fileName}>
      <div className="flex min-h-[56px] items-center gap-2 border-b border-white/10 bg-oa-bg px-3 text-oa-text">
        <FileText className="h-4 w-4 shrink-0 text-oa-red" aria-hidden="true" />
        <div className="min-w-0 flex-1 truncate text-sm font-medium">{fileName}</div>
        <button type="button" className="flex h-9 w-9 items-center justify-center rounded text-oa-text-muted hover:bg-oa-surface" onClick={() => setPageNumber((p) => Math.max(1, p - 1))} disabled={!canPrev} aria-label="Previous page">
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </button>
        <span className="w-20 text-center text-xs text-oa-text-muted">{pageNumber} / {pageCount}</span>
        <button type="button" className="flex h-9 w-9 items-center justify-center rounded text-oa-text-muted hover:bg-oa-surface" onClick={() => setPageNumber((p) => Math.min(pageCount, p + 1))} disabled={!canNext} aria-label="Next page">
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </button>
        <button type="button" className="flex h-9 w-9 items-center justify-center rounded text-oa-text-muted hover:bg-oa-surface" onClick={() => setScale((value) => Math.max(0.5, value - 0.15))} aria-label="Zoom out">
          <Minus className="h-4 w-4" aria-hidden="true" />
        </button>
        <span className="w-12 text-center text-xs text-oa-text-muted">{zoomLabel}</span>
        <button type="button" className="flex h-9 w-9 items-center justify-center rounded text-oa-text-muted hover:bg-oa-surface" onClick={() => setScale((value) => Math.min(2.5, value + 0.15))} aria-label="Zoom in">
          <Plus className="h-4 w-4" aria-hidden="true" />
        </button>
        {downloadHref && (
          <a href={downloadHref} download className="flex h-9 w-9 items-center justify-center rounded text-oa-text-muted hover:bg-oa-surface" aria-label={`Download ${fileName}`}>
            <Download className="h-4 w-4" aria-hidden="true" />
          </a>
        )}
        <button type="button" className="flex h-9 w-9 items-center justify-center rounded text-oa-text-muted hover:bg-oa-surface" onClick={onClose} aria-label="Close PDF viewer">
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <div className="flex flex-1 justify-center overflow-auto p-4">
        {!url || viewer.isLoading ? (
          <div className="mt-16 flex items-center gap-2 text-sm text-white/80">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Loading PDF
          </div>
        ) : renderError ? (
          <div className="mt-16 rounded-lg border border-oa-red/30 bg-oa-red/10 px-4 py-3 text-sm text-oa-red">{renderError}</div>
        ) : (
          <canvas ref={canvasRef} className="h-fit max-w-none rounded bg-white shadow-2xl" />
        )}
      </div>
    </div>
  );
}
