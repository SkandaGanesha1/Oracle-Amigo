import { useState, useMemo } from "react";
import { HardDrive, Search, Eye, Download, Ban, FolderOpen, FolderClosed, X, Shield, ShieldCheck, ShieldOff, Database, RefreshCw, AlertTriangle, FileText, Clock, Globe, Trash2, Plus, Minus, type LucideIcon } from "lucide-react";
import { useReceivedFiles, useFileIndexRoots, useFileSearch, useIndexedFiles, useReindexFiles, useTransfers, useConsentAction, usePendingApprovals, useVaultRoots, useAddVaultRoot, useRemoveVaultRoot, useVaultExcludes, useAddVaultExclude, useRemoveVaultExclude } from "../../hooks/queries";
import { FilePreviewDrawer } from "../files/FilePreviewDrawer";
import { formatSize } from "../../lib/format";
import { usePrivacyMode } from "../../lib/usePrivacyMode";
import { RevealableText } from "../../components/primitives/RevealableText";
import type { StoredFile } from "../../api/types";
import { detectFileSensitivity, SENSITIVITY_CONFIG } from "../../types";
import { toast } from "../../components/primitives/OracleToast";

function getFolderIcon(path: string): LucideIcon {
  if (/\b(downloads?)\b/i.test(path)) return FolderOpen;
  if (/\b(documents?|docs?)\b/i.test(path)) return FileText;
  if (/\b(desktop)\b/i.test(path)) return Globe;
  return FolderClosed;
}

function safeDisplayPath(path: string): string {
  return path
    .replace(/[A-Za-z]:\\(?:Users|Documents and Settings)\\[^\\]+/g, "Local user folder")
    .replace(/(?:\/Users|\/home)\/[^/]+/g, "Local user folder");
}

function VaultExcludesList({ rootPath, onRemove }: { rootPath: string; onRemove: (id: number) => void }) {
  const { data: excludesData } = useVaultExcludes(rootPath);
  const excludes = excludesData?.excludes ?? [];

  if (excludes.length === 0) {
    return (
      <p className="mt-3 text-[10px] text-oa-text-muted">No excludes for this folder yet.</p>
    );
  }

  return (
    <div className="mt-3 space-y-1.5">
      {excludes.map((exclude: { id: number; rootPath: string; excludePath: string; excludeType: string; createdAt: string }) => (
        <div key={exclude.id} className="flex items-center gap-3 rounded-lg border border-oa-border bg-oa-bg-elevated p-2.5">
          <ShieldOff className="h-4 w-4 text-oa-amber shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium text-oa-text">{exclude.excludePath}</p>
            <p className="text-[9px] text-oa-text-muted">{exclude.excludeType}</p>
          </div>
          <button
            type="button"
            onClick={() => onRemove(exclude.id)}
            className="flex h-7 w-7 items-center justify-center rounded text-oa-red/60 hover:bg-oa-red/10 hover:text-oa-red"
            title="Remove exclude"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}

export function VaultBrowser() {
  const { data: rootsData } = useFileIndexRoots();
  const { data: vaultRootsData } = useVaultRoots();
  const { data: indexedData } = useIndexedFiles(50, 0);
  const [indexedSearchQuery, setIndexedSearchQuery] = useState("");
  const [storedSearchQuery, setStoredSearchQuery] = useState("");
  const normalizedIndexedSearchQuery = indexedSearchQuery.trim();
  const { data: searchResults } = useFileSearch(normalizedIndexedSearchQuery);
  const { data: filesData, isLoading } = useReceivedFiles();
  const { data: transfersData } = useTransfers();
  const { approvalCards } = usePendingApprovals();
  const reindex = useReindexFiles();
  const consentAction = useConsentAction();

  const addVaultRoot = useAddVaultRoot();
  const removeVaultRoot = useRemoveVaultRoot();
  const addVaultExclude = useAddVaultExclude();
  const removeVaultExclude = useRemoveVaultExclude();

  const privacyMode = usePrivacyMode();

  const files = filesData?.files ?? [];
  const roots = rootsData?.roots ?? [];
  const vaultRoots = vaultRootsData?.roots ?? [];
  const indexed = indexedData?.items ?? [];
  const transfers = transfersData?.transfers ?? [];

  const [previewFile, setPreviewFile] = useState<StoredFile | null>(null);
  const [showIndexRoots, setShowIndexRoots] = useState(true);
  const [showTransfers, setShowTransfers] = useState(false);
  const [showExcludes, setShowExcludes] = useState(false);
  const [newRootPath, setNewRootPath] = useState("");
  const [newExcludePath, setNewExcludePath] = useState("");
  const [selectedRootForExclude, setSelectedRootForExclude] = useState<string | null>(null);

  const filteredFiles = useMemo(() => {
    if (!storedSearchQuery.trim()) return files;
    const q = storedSearchQuery.toLowerCase();
    return files.filter((f) => f.originalFileName.toLowerCase().includes(q));
  }, [files, storedSearchQuery]);

  const indexedDisplay = normalizedIndexedSearchQuery ? (searchResults ?? []) : indexed;
  const indexedWithSensitivity = useMemo(() => {
    return indexedDisplay.map((file) => ({
      ...file,
      sensitivity: detectFileSensitivity(file.fileName, file.displayPath),
    }));
  }, [indexedDisplay]);

  const handleRevoke = (fileId: string) => {
    const match = approvalCards.find((a) =>
      a.candidates.some((c) => c.candidate_id === fileId || c.file_name === fileId)
    );
    if (match) {
      consentAction.mutate({ consentId: match.approval_id, action: "revoke" });
    }
  };

  const handleAddRoot = async () => {
    if (!newRootPath.trim()) return;
    try {
      await addVaultRoot.mutateAsync({ rootPath: newRootPath });
      setNewRootPath("");
      toast.success("Folder added to vault");
    } catch (error) {
      toast.danger(error instanceof Error ? error.message : "Failed to add folder");
    }
  };

  const handleRemoveRoot = async (id: number, rootPath: string) => {
    try {
      await removeVaultRoot.mutateAsync(id);
      toast.success(`Removed ${rootPath} from vault`);
    } catch (error) {
      toast.danger(error instanceof Error ? error.message : "Failed to remove folder");
    }
  };

  const handleAddExclude = async () => {
    if (!newExcludePath.trim() || !selectedRootForExclude) return;
    try {
      await addVaultExclude.mutateAsync({ rootPath: selectedRootForExclude, excludePath: newExcludePath });
      setNewExcludePath("");
      toast.success("Exclude rule added");
    } catch (error) {
      toast.danger(error instanceof Error ? error.message : "Failed to add exclude rule");
    }
  };

  const handleRemoveExclude = async (id: number) => {
    try {
      await removeVaultExclude.mutateAsync(id);
      toast.success("Exclude rule removed");
    } catch (error) {
      toast.danger(error instanceof Error ? error.message : "Failed to remove exclude rule");
    }
  };

  return (
    <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-6 max-w-7xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-oa-text">Vault</h1>
          <p className="text-sm text-oa-text-muted">
            {files.length} stored files &middot; {indexed.length} indexed files &middot; {roots.length} roots
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-[10px] text-oa-text-muted cursor-pointer">
            <input
              type="checkbox"
              checked={privacyMode.value}
              onChange={() => privacyMode.toggle()}
              className="h-3 w-3 accent-oa-blue"
            />
            Privacy mode
          </label>
          <button
            type="button"
            onClick={() => reindex.mutate(roots)}
            disabled={reindex.isPending || roots.length === 0}
            className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-oa-border bg-oa-surface-2 px-2.5 text-[10px] text-oa-text-muted hover:bg-oa-surface disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${reindex.isPending ? "animate-spin" : ""}`} />
            Reindex
          </button>
        </div>
      </div>

      <section className="grid gap-3 lg:grid-cols-4">
        <Metric icon={HardDrive} label="Vault Folders" value={vaultRoots.length} />
        <Metric icon={Database} label="Indexed Files" value={indexedData?.total ?? indexed.length} />
        <Metric icon={Shield} label="Stored Files" value={files.length} />
        <Metric icon={Globe} label="Transfers" value={transfers.length} />
      </section>

      <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <section className="rounded-xl border border-oa-border bg-oa-surface/80 overflow-hidden">
          <button
            type="button"
            onClick={() => setShowIndexRoots(!showIndexRoots)}
            className="flex w-full items-center gap-2 px-4 py-3 text-left"
          >
            <HardDrive className="h-4 w-4 text-oa-blue" />
            <h2 className="text-sm font-semibold text-oa-text">Vault Folders</h2>
            <span className="ml-auto text-[10px] text-oa-text-muted">{vaultRoots.length} folders</span>
          </button>
          {showIndexRoots && (
            <div className="border-t border-oa-border px-4 pb-4">
              {vaultRoots.length === 0 ? (
                <p className="mt-3 rounded-lg border border-dashed border-oa-border bg-oa-bg-elevated p-3 text-xs text-oa-text-muted">
                  No vault folders configured. Add folders to index and manage your file vault.
                </p>
              ) : (
                <div className="mt-3 space-y-2">
                  {vaultRoots.map((root: { id: number; rootPath: string; displayName: string; enabled: boolean; lastIndexedAt: string | null; fileCount: number; createdAt: string; updatedAt: string }) => {
                    const FolderIcon = getFolderIcon(root.rootPath);
                    const sen = detectFileSensitivity("", root.rootPath);
                    const sc = SENSITIVITY_CONFIG[sen.level];
                    return (
                      <div key={root.id} className="flex items-center gap-3 rounded-lg border border-oa-border bg-oa-bg-elevated p-3">
                        <FolderIcon className="h-4 w-4 text-oa-blue shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-medium text-oa-text">{root.displayName}</p>
                          <p className="text-[10px] text-oa-text-muted">{safeDisplayPath(root.rootPath)}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-[9px] text-oa-text-muted">{root.fileCount} files</span>
                            {root.lastIndexedAt && (
                              <>
                                <span className="text-oa-text-disabled">&middot;</span>
                                <span className="text-[9px] text-oa-text-muted">Indexed {new Date(root.lastIndexedAt).toLocaleDateString()}</span>
                              </>
                            )}
                          </div>
                        </div>
                        <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-medium ${sc.color} ${sc.bg}`}>
                          {sc.label}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleRemoveRoot(root.id, root.rootPath)}
                          className="flex h-7 w-7 items-center justify-center rounded text-oa-red/60 hover:bg-oa-red/10 hover:text-oa-red"
                          title="Remove folder"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="mt-3 flex gap-2">
                <input
                  value={newRootPath}
                  onChange={(e) => setNewRootPath(e.target.value)}
                  placeholder="Add folder path to vault..."
                  className="h-10 min-w-0 flex-1 rounded-lg border border-oa-border bg-oa-bg px-3 text-xs text-oa-text outline-none focus:border-oa-blue"
                />
                <button
                  type="button"
                  onClick={handleAddRoot}
                  disabled={!newRootPath.trim() || addVaultRoot.isPending}
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-oa-border bg-oa-blue/10 px-3 text-xs text-oa-blue disabled:opacity-50"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add
                </button>
              </div>
            </div>
          )}
        </section>

        <section className="rounded-xl border border-oa-border bg-oa-surface/80 overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3">
            <Shield className="h-4 w-4 text-oa-purple" />
            <h2 className="text-sm font-semibold text-oa-text">{normalizedIndexedSearchQuery ? "Indexed Search Results" : "Indexed Files"}</h2>
            <span className="ml-auto text-[10px] text-oa-text-muted">
              {indexedWithSensitivity.length} {normalizedIndexedSearchQuery ? "matches" : "files"}
            </span>
          </div>
          <div className="border-t border-oa-border px-4 pb-4">
            <div className="relative mt-3">
              <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-oa-text-muted" />
              <input
                value={indexedSearchQuery}
                onChange={(e) => setIndexedSearchQuery(e.target.value)}
                placeholder="Search indexed file contents..."
                className="h-10 w-full rounded-lg border border-oa-border bg-oa-bg pl-9 pr-9 text-xs text-oa-text outline-none focus:border-oa-blue"
              />
              {indexedSearchQuery && (
                <button type="button" onClick={() => setIndexedSearchQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-oa-text-muted hover:text-oa-text" aria-label="Clear indexed search">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            {indexedWithSensitivity.length === 0 ? (
              <p className="mt-3 rounded-lg border border-dashed border-oa-border bg-oa-bg-elevated p-3 text-xs text-oa-text-muted">
                {normalizedIndexedSearchQuery ? "No indexed files match this search." : "No files indexed yet. Add roots and run index."}
              </p>
            ) : (
              <div className="mt-3 space-y-1.5 max-h-64 overflow-y-auto">
                {indexedWithSensitivity.slice(0, 20).map((file) => {
                  const sc = SENSITIVITY_CONFIG[file.sensitivity.level];
                  return (
                    <div key={file.id} className="flex items-center gap-3 rounded-lg border border-oa-border bg-oa-bg-elevated p-2.5">
                      <div className={`flex h-6 w-6 items-center justify-center rounded-md ${sc.bg}`}>
                        <FileText className={`h-3 w-3 ${sc.color}`} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-oa-text">
                          {privacyMode.value ? <RevealableText text={file.fileName} /> : file.fileName}
                        </p>
                        <p className="truncate text-[9px] text-oa-text-muted">{file.displayPath}</p>
                      </div>
                      <span className={`shrink-0 rounded px-1.5 py-0.5 text-[8px] font-medium ${sc.color} ${sc.bg}`}>
                        {file.sensitivity.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </div>

      <section className="rounded-xl border border-oa-border bg-oa-surface/80 overflow-hidden">
        <button
          type="button"
          onClick={() => setShowExcludes(!showExcludes)}
          className="flex w-full items-center gap-2 px-4 py-3 text-left"
        >
          <ShieldOff className="h-4 w-4 text-oa-amber" />
          <h2 className="text-sm font-semibold text-oa-text">Excluded Folders</h2>
          <span className="ml-auto text-[10px] text-oa-text-muted">Privacy filters</span>
        </button>
        {showExcludes && (
          <div className="border-t border-oa-border px-4 pb-4">
            <div className="mt-3 flex gap-2">
              <select
                value={selectedRootForExclude ?? ""}
                onChange={(e) => setSelectedRootForExclude(e.target.value || null)}
                className="h-10 min-w-0 flex-1 rounded-lg border border-oa-border bg-oa-bg px-3 text-xs text-oa-text outline-none focus:border-oa-blue"
              >
                <option value="">Select folder to exclude from...</option>
                {vaultRoots.map((root: { id: number; rootPath: string; displayName: string }) => (
                  <option key={root.id} value={root.rootPath}>{root.displayName}</option>
                ))}
              </select>
              <input
                value={newExcludePath}
                onChange={(e) => setNewExcludePath(e.target.value)}
                placeholder="Exclude path or pattern..."
                className="h-10 min-w-0 flex-1 rounded-lg border border-oa-border bg-oa-bg px-3 text-xs text-oa-text outline-none focus:border-oa-blue"
                disabled={!selectedRootForExclude}
              />
              <button
                type="button"
                onClick={handleAddExclude}
                disabled={!newExcludePath.trim() || !selectedRootForExclude || addVaultExclude.isPending}
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-oa-border bg-oa-amber/10 px-3 text-xs text-oa-amber disabled:opacity-50"
              >
                <Minus className="h-3.5 w-3.5" />
                Exclude
              </button>
            </div>
            {selectedRootForExclude && (
              <VaultExcludesList rootPath={selectedRootForExclude} onRemove={handleRemoveExclude} />
            )}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-oa-border bg-oa-surface/80 overflow-hidden">
        <button
          type="button"
          onClick={() => setShowTransfers(!showTransfers)}
          className="flex w-full items-center gap-2 px-4 py-3 text-left"
        >
          <Clock className="h-4 w-4 text-oa-amber" />
          <h2 className="text-sm font-semibold text-oa-text">Share History</h2>
          <span className="ml-auto text-[10px] text-oa-text-muted">{transfers.length} transfers</span>
        </button>
        {showTransfers && (
          <div className="border-t border-oa-border px-4 pb-4">
            {transfers.length === 0 ? (
              <p className="mt-3 rounded-lg border border-dashed border-oa-border bg-oa-bg-elevated p-3 text-xs text-oa-text-muted">
                No file transfers yet.
              </p>
            ) : (
              <div className="mt-3 space-y-1.5 max-h-48 overflow-y-auto">
                {transfers.slice(0, 10).map((t, i) => {
                  const fileName = String(t.file_name ?? t.fileName ?? "Unknown");
                  const sen = detectFileSensitivity(fileName);
                  const sc = SENSITIVITY_CONFIG[sen.level];
                  return (
                    <div key={String(t.id ?? i)} className="flex items-center gap-3 rounded-lg border border-oa-border bg-oa-bg-elevated p-2.5">
                      <div className={`flex h-6 w-6 items-center justify-center rounded-md ${sc.bg}`}>
                        <Globe className={`h-3 w-3 ${sc.color}`} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-oa-text">{fileName}</p>
                        <p className="text-[9px] text-oa-text-muted">{String(t.status ?? "completed")}</p>
                      </div>
                      <span className={`shrink-0 rounded px-1.5 py-0.5 text-[8px] font-medium ${sc.color} ${sc.bg}`}>
                        {sc.label}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleRevoke(String(t.file_id ?? t.id ?? ""))}
                        className="flex h-6 w-6 items-center justify-center rounded text-oa-red/60 hover:text-oa-red"
                        title="Revoke access"
                      >
                        <Ban className="h-3 w-3" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-oa-border bg-oa-surface/80 p-4">
        <div className="mb-3 flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-oa-green" />
          <h2 className="text-sm font-semibold text-oa-text">Stored Files</h2>
          <span className="ml-auto text-[10px] text-oa-text-muted">{filteredFiles.length} files</span>
        </div>

        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-oa-text-muted" />
          <input
            value={storedSearchQuery}
            onChange={(e) => setStoredSearchQuery(e.target.value)}
            placeholder="Search stored files..."
            className="h-10 w-full rounded-lg border border-oa-border bg-oa-bg pl-9 pr-3 text-xs text-oa-text outline-none focus:border-oa-blue"
          />
          {storedSearchQuery && (
            <button type="button" onClick={() => setStoredSearchQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-oa-text-muted hover:text-oa-text" aria-label="Clear stored file search">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="flex gap-1">
              <span className="h-2 w-2 animate-bounce rounded-full bg-oa-text-muted" style={{ animationDelay: "0ms" }} />
              <span className="h-2 w-2 animate-bounce rounded-full bg-oa-text-muted" style={{ animationDelay: "150ms" }} />
              <span className="h-2 w-2 animate-bounce rounded-full bg-oa-text-muted" style={{ animationDelay: "300ms" }} />
            </div>
          </div>
        ) : filteredFiles.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 gap-2">
            <HardDrive className="h-6 w-6 text-oa-text-muted" />
            <p className="text-xs text-oa-text-disabled">{storedSearchQuery ? "No matching files" : "No stored files yet"}</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {filteredFiles.map((file) => {
              const sen = detectFileSensitivity(file.originalFileName, file.storedPath);
              const sc = SENSITIVITY_CONFIG[sen.level];
              return (
                <div key={file.id} className="flex items-center gap-3 rounded-lg border border-oa-border bg-oa-surface p-2.5 hover:border-oa-border-strong transition-colors">
                  <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${sc.bg}`}>
                    <FileText className={`h-4 w-4 ${sc.color}`} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-oa-text">
                      {privacyMode.value ? <RevealableText text={file.originalFileName} /> : file.originalFileName}
                    </p>
                    <div className="flex items-center gap-2 text-[10px] text-oa-text-muted">
                      <span>{formatSize(file.sizeBytes)}</span>
                      <span className="text-oa-text-disabled">&middot;</span>
                      <span className="font-mono">{file.sha256.slice(0, 12)}...</span>
                      <span className="text-oa-text-disabled">&middot;</span>
                      <span>{new Date(file.receivedAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                  <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-medium ${sc.color} ${sc.bg}`}>
                    {sc.label}
                  </span>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => setPreviewFile(file)}
                      className="flex h-7 w-7 items-center justify-center rounded text-oa-text-muted hover:bg-oa-surface-2"
                      aria-label="Preview"
                    >
                      <Eye className="h-3.5 w-3.5" />
                    </button>
                    <a
                      href={`/storage/files/${encodeURIComponent(file.id)}/download`}
                      className="flex h-7 w-7 items-center justify-center rounded text-oa-text-muted hover:bg-oa-surface-2"
                      download
                      aria-label="Download"
                    >
                      <Download className="h-3.5 w-3.5" />
                    </a>
                    <button
                      type="button"
                      onClick={() => handleRevoke(file.id)}
                      className="flex h-7 w-7 items-center justify-center rounded text-oa-red/60 hover:bg-oa-red/10 hover:text-oa-red"
                      aria-label="Revoke"
                      title="Revoke access"
                    >
                      <Ban className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <FilePreviewDrawer file={previewFile} onClose={() => setPreviewFile(null)} />
    </div>
  );
}

function Metric({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: number }) {
  return (
    <div className="rounded-xl border border-oa-border bg-oa-surface/80 p-4">
      <Icon className="mb-3 h-4 w-4 text-oa-blue" />
      <p className="text-2xl font-semibold text-oa-text">{value}</p>
      <p className="text-xs text-oa-text-muted">{label}</p>
    </div>
  );
}
