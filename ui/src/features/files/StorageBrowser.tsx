import { useState } from "react";
import { useReceivedFiles } from "../../hooks/queries";
import { FileTypeIcon } from "./FileTypeIcon";
import { FilePreviewDrawer } from "./FilePreviewDrawer";
import { VerifyHashButton } from "./VerifyHashButton";
import { formatSize } from "../../lib/format";
import { HardDrive, Download, Search, Eye } from "lucide-react";
import type { StoredFile } from "../../api/types";
import { cn } from "~/lib/utils";

type SortField = "date" | "name" | "size";
type SortDir = "asc" | "desc";

export function StorageBrowser() {
  const { data, isLoading } = useReceivedFiles();
  const files = data?.files ?? [];
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState<SortField>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [previewFile, setPreviewFile] = useState<StoredFile | null>(null);

  const filtered = files
    .filter((f) => f.originalFileName.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      let cmp = 0;
      if (sortField === "name") cmp = a.originalFileName.localeCompare(b.originalFileName);
      else if (sortField === "size") cmp = a.sizeBytes - b.sizeBytes;
      else cmp = new Date(a.receivedAt).getTime() - new Date(b.receivedAt).getTime();
      return sortDir === "asc" ? cmp : -cmp;
    });

  function toggleSort(field: SortField) {
    if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortField(field); setSortDir("desc"); }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="flex gap-1">
          <span className="h-2 w-2 animate-bounce rounded-full bg-oa-text-muted" style={{ animationDelay: "0ms" }} />
          <span className="h-2 w-2 animate-bounce rounded-full bg-oa-text-muted" style={{ animationDelay: "150ms" }} />
          <span className="h-2 w-2 animate-bounce rounded-full bg-oa-text-muted" style={{ animationDelay: "300ms" }} />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-oa-text-muted" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search files..."
          className="w-full rounded-lg border border-oa-border bg-oa-bg py-2 pl-8 pr-3 text-xs text-oa-text placeholder-oa-text-disabled outline-none focus:border-oa-blue"
        />
      </div>

      <div className="flex gap-4 text-[10px] text-oa-text-muted px-1">
        <button type="button" onClick={() => toggleSort("name")} className={cn("hover:text-oa-text transition-colors", sortField === "name" && "font-medium text-oa-text")}>
          Name {sortField === "name" && (sortDir === "asc" ? "ASC" : "DESC")}
        </button>
        <button type="button" onClick={() => toggleSort("size")} className={cn("hover:text-oa-text transition-colors", sortField === "size" && "font-medium text-oa-text")}>
          Size {sortField === "size" && (sortDir === "asc" ? "ASC" : "DESC")}
        </button>
        <button type="button" onClick={() => toggleSort("date")} className={cn("hover:text-oa-text transition-colors", sortField === "date" && "font-medium text-oa-text")}>
          Date {sortField === "date" && (sortDir === "asc" ? "ASC" : "DESC")}
        </button>
        <span className="ml-auto">{filtered.length} file{filtered.length !== 1 ? "s" : ""}</span>
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 gap-2">
          <HardDrive className="h-6 w-6 text-oa-text-muted" />
          <p className="text-xs text-oa-text-disabled">{search ? "No matching files" : "No stored files yet"}</p>
        </div>
      ) : (
        <div className="space-y-1">
          {filtered.map((file) => {
            const ext = file.originalFileName.split(".").pop() ?? "";
            return (
              <div
                key={file.id}
                className="flex items-center gap-3 rounded-lg border border-oa-border bg-oa-surface p-2.5 hover:border-oa-border-strong transition-colors"
              >
                <FileTypeIcon extension={ext} className="h-5 w-5 shrink-0 text-oa-text-muted" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-oa-text">{file.originalFileName}</p>
                  <div className="flex items-center gap-2 text-[10px] text-oa-text-muted">
                    <span>{formatSize(file.sizeBytes)}</span>
                    <span className="text-oa-text-disabled">&middot;</span>
                    <span className="font-mono">{file.sha256.slice(0, 12)}...</span>
                    <span className="text-oa-text-disabled">&middot;</span>
                    <span>{new Date(file.receivedAt).toLocaleDateString()}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <VerifyHashButton fileId={file.id} />
                  <button
                    type="button"
                    onClick={() => setPreviewFile(file)}
                    className="inline-flex items-center gap-1 rounded border border-oa-border bg-oa-surface-2 px-2 py-1 text-[10px] text-oa-text-muted transition hover:bg-oa-surface"
                    aria-label="Preview file"
                  >
                    <Eye className="h-3 w-3" />
                  </button>
                  <a
                    href={`/storage/files/${encodeURIComponent(file.id)}/download`}
                    className="inline-flex items-center gap-1 rounded border border-oa-border bg-oa-surface-2 px-2 py-1 text-[10px] text-oa-text-muted transition hover:bg-oa-surface"
                    download
                  >
                    <Download className="h-3 w-3" />
                  </a>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <FilePreviewDrawer file={previewFile} onClose={() => setPreviewFile(null)} />
    </div>
  );
}
